import { workerIdentity } from './workerIdentity.js';
import { dawIdentity, issueDawKey } from './dawIdentity.js';
import { Router, json, type Express, type Request, type Response, type RequestHandler } from 'express';
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node';
import { hashPassword } from 'better-auth/crypto';
import { createHash, randomUUID, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import { z } from 'zod';
import type { IdentityService } from './service.js';
import { principalContext, principalOf } from './principal.js';
import { takeJobRequest } from './jobRequests.js';

const credentials = z.object({ email: z.string().email().max(254).transform(s => s.trim().toLowerCase()),
  password: z.string().min(12).max(128), name: z.string().trim().min(1).max(80) });
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const setting = (s: IdentityService) => s.db.prepare('SELECT * FROM registration_settings WHERE id=1').get() as
  {mode: 'open'|'invite'|'closed'; bootstrap_complete: number; legacy_user_id: string|null};
function deny(res: Response, status=403) { res.status(status).json({ error: status===401 ? 'Authentication required' : 'Request not permitted' }); }
export function requireAdministrator(req: Request, res: Response, next: () => void) {
  if (principalOf(req)?.role !== 'admin') { deny(res); return; } next();
}
export function identityMiddleware(s: IdentityService): RequestHandler {
  return async (req, res, next) => {
    try {
      const internal=(req as Request & {jobPrincipal?:ReturnType<typeof principalOf>}).jobPrincipal;
      if(internal){
        const user=s.db.prepare('SELECT banned FROM users WHERE id=?').get(internal.id) as {banned:number}|undefined;
        if(!user||user.banned){deny(res,401);return;}
        Object.assign(req,{principal:internal});res.setHeader('Cache-Control','private, no-store');
        principalContext.run(internal,next);return;
      }
      const session = await s.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
      if (!session || !setting(s).bootstrap_complete) { deny(res,401); return; }
      if (req.headers['x-hotstep-user'] && req.headers['x-hotstep-user'] !== session.user.id) { deny(res,401); return; }
      const row = s.db.prepare('SELECT role,banned FROM users WHERE id=?').get(session.user.id) as {role:string;banned:number}|undefined;
      if (!row || row.banned) { deny(res,401); return; }
      const principal = {id:session.user.id, role: row.role==='admin' ? 'admin' as const : 'user' as const, sessionId:session.session.id};
      Object.assign(req, {principal});
      // Recheck long-lived SSE/media connections after logout, password reset or expiry.
      const timer=setInterval(()=>{
        const live=s.db.prepare('SELECT 1 FROM auth_sessions s JOIN users u ON u.id=s.userId WHERE s.id=? AND s.expiresAt>? AND u.banned=0').get(principal.sessionId,Date.now());
        if(!live){res.end();clearInterval(timer);}
      },1000);timer.unref();res.once('close',()=>clearInterval(timer));res.once('finish',()=>clearInterval(timer));
      res.setHeader('Cache-Control','private, no-store');
      principalContext.run(principal, next);
    } catch { deny(res,401); }
  };
}

/** Called BEFORE express.json and before every legacy API/static media mount. */
export function installIdentityHTTP(app: Express, s: IdentityService) {
  app.use('/api', (req,res,next) => {
    // Never trust caller-supplied forwarding headers for the authentication limiter.
    // Behind a proxy this deliberately uses the proxy's shared bucket.
    req.headers['x-hotstep-client-ip']=req.socket.remoteAddress??'127.0.0.1';
    const jobPrincipal=takeJobRequest(req) ?? workerIdentity(req,s.db,s.workerToken) ?? dawIdentity(req,s.db);if(jobPrincipal){Object.assign(req,{jobPrincipal});next();return;}
    if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin !== s.origin) { deny(res); return; }
    if (req.headers.origin && req.headers.origin !== s.origin) { deny(res); return; }
    next();
  });
  const publicAuthPaths = new Set(['/sign-in/email','/sign-out','/get-session','/change-password','/list-sessions','/revoke-session','/revoke-sessions','/revoke-other-sessions']);
  app.use('/api/auth', (req,res,next) => {
    if (['/me','/username','/logout','/auto','/setup'].includes(req.path)) return next();
    // Direct signup/admin/linking must not bypass the application policies.
    if (!publicAuthPaths.has(req.path)) { res.status(404).json({error:'Not found'}); return; }
    return toNodeHandler(s.auth)(req,res);
  });
  const routes = Router();
  routes.use(json({limit:'32kb'}));
  const authenticate = identityMiddleware(s);
  const attempts = new Map<string,{count:number;until:number}>();
  const limited: RequestHandler = (req,res,next) => {
    const key = req.socket.remoteAddress ?? 'unknown'; const now=Date.now();
    for(const [k,v] of attempts) if(v.until<=now) attempts.delete(k);
    const entry=attempts.get(key) ?? {count:0,until:now+60_000}; entry.count++; attempts.set(key,entry);
    if(entry.count>10 || attempts.size>10_000){res.setHeader('Retry-After','60');res.status(429).json({error:'Please try again later'});return;} next();
  };
  routes.get('/status',(_req,res)=>{const st=setting(s);res.json({setupRequired:!st.bootstrap_complete,registrationMode:st.bootstrap_complete?st.mode:'closed',passwordReset:'administrator'});});
  let registrationTail: Promise<unknown> = Promise.resolve();
  const serial = (work:()=>Promise<void>) => { const result=registrationTail.then(work); registrationTail=result.catch(()=>{}); return result; };
  routes.post('/setup',limited,async(req,res)=>{
    const parsed=credentials.extend({setupToken:z.string().min(32).max(128)}).safeParse(req.body);
    if(!parsed.success){res.status(400).json({error:'Check the supplied fields (password: 12–128 characters)'});return;}
    await serial(async()=>{
      if(setting(s).bootstrap_complete){res.status(409).json({error:'Initial setup is already complete'});return;}
      const supplied=Buffer.from(parsed.data.setupToken); const expected=Buffer.from(fs.readFileSync(s.setupFile,'utf8').trim());
      if(supplied.length!==expected.length || !timingSafeEqual(supplied,expected)){deny(res);return;}
      const password=await hashPassword(parsed.data.password);
      const id=setting(s).legacy_user_id ?? randomUUID(); const now=Date.now();
      s.db.transaction(()=>{
        if(setting(s).bootstrap_complete)throw new Error('Setup already completed');
        s.db.prepare(`INSERT INTO users(id,username,email,emailVerified,role,auth_created_at,auth_updated_at)
          VALUES(?,?,?,0,'admin',?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username,email=excluded.email,
          role='admin',auth_created_at=excluded.auth_created_at,auth_updated_at=excluded.auth_updated_at`)
          .run(id,parsed.data.name,parsed.data.email,now,now);
        s.db.prepare(`INSERT INTO auth_accounts(id,accountId,providerId,userId,password,createdAt,updatedAt)
          VALUES(?,?,'credential',?,?,?,?)`).run(randomUUID(),id,id,password,now,now);
        s.db.prepare('UPDATE registration_settings SET bootstrap_complete=1,updated_at=? WHERE id=1').run(now);
      })();
      fs.rmSync(s.setupFile,{force:true}); res.json({ok:true});
    }).catch(()=>{if(!res.headersSent)res.status(400).json({error:'Setup could not be completed'});});
  });
  routes.post('/register',limited,async(req,res)=>{
    const parsed=credentials.extend({inviteCode:z.string().max(128).optional()}).safeParse(req.body);
    if(!parsed.success){res.status(400).json({error:'Check the supplied fields (password: 12–128 characters)'});return;}
    await serial(async()=>{
      const st=setting(s);if(!st.bootstrap_complete || st.mode==='closed'){deny(res);return;}
      const invitation=parsed.data.inviteCode ? digest(parsed.data.inviteCode) : '';
      const reservation = `reserved:${randomUUID()}`;
      if(st.mode==='invite' && s.db.prepare('UPDATE registration_invites SET used_by=? WHERE digest=? AND used_by IS NULL AND expires_at>?').run(reservation,invitation,Date.now()).changes!==1){deny(res);return;}
      try {
        const result=await s.auth.api.signUpEmail({body:{name:parsed.data.name,email:parsed.data.email,password:parsed.data.password}});
        if(st.mode==='invite')s.db.prepare('UPDATE registration_invites SET used_by=? WHERE digest=? AND used_by=?').run(result.user.id,invitation,reservation);
        // Require sign-in: never expose Better Auth's session token in this response.
        s.db.prepare('DELETE FROM auth_sessions WHERE userId=?').run(result.user.id);
        res.status(201).json({ok:true});
      }catch{if(st.mode==='invite')s.db.prepare('UPDATE registration_invites SET used_by=NULL WHERE digest=? AND used_by=?').run(invitation,reservation);res.status(400).json({error:'Account could not be created. Check the details or contact the administrator.'});}
    });
  });
  routes.use(authenticate);
  routes.post('/daw-key',(req,res)=>res.json(issueDawKey(s.db,principalOf(req)!.id)));
  routes.delete('/daw-key',(req,res)=>{s.db.prepare('DELETE FROM auth_daw_keys WHERE user_id=?').run(principalOf(req)!.id);res.json({ok:true});});
  routes.get('/me',(req,res)=>{
    const id=principalOf(req)!.id;
    const user=s.db.prepare('SELECT id,username,email,role,bio,avatar_url,banner_url,created_at FROM users WHERE id=?').get(id);
    res.json({user,legacyOwner:setting(s).legacy_user_id===id});
  });
  routes.patch('/profile',async(req,res)=>{
    const parsed=z.object({name:z.string().trim().min(1).max(80)}).safeParse(req.body);
    if(!parsed.success){res.status(400).json({error:'A name is required'});return;}
    try{await s.auth.api.updateUser({headers:fromNodeHeaders(req.headers),body:{name:parsed.data.name}});res.json({ok:true});}
    catch{res.status(400).json({error:'Profile could not be updated'});}
  });
  routes.use('/admin',requireAdministrator);
  routes.post('/admin/folders',async(req,res)=>{
    const parsed=z.object({folder:z.string().min(1).max(4096),userId:z.string().min(1).max(128)}).safeParse(req.body);
    if(!parsed.success){deny(res,400);return;}
    try{const {grantImportFolder}=await import('./folderGrants.js');const assetId=grantImportFolder(s.db,s.authDir.replace(/[\\/]auth-private$/,''),parsed.data.folder,parsed.data.userId);res.status(201).json({assetId});}
    catch{res.status(400).json({error:'Choose an unassigned import folder outside system, shared-model and application folders'});}
  });
  routes.get('/admin/users',(_req,res)=>res.json({users:s.db.prepare('SELECT id,username,email,role,banned,created_at FROM users ORDER BY created_at,id').all()}));
  routes.get('/admin/registration',(_req,res)=>res.json({mode:setting(s).mode}));
  routes.put('/admin/registration',(req,res)=>{
    const mode=z.enum(['open','invite','closed']).safeParse(req.body.mode);if(!mode.success){deny(res,400);return;}
    s.db.prepare('UPDATE registration_settings SET mode=?,updated_at=? WHERE id=1').run(mode.data,Date.now());res.json({mode:mode.data});
  });
  routes.post('/admin/invitations',(req,res)=>{
    const code=randomBytes(24).toString('base64url');const expiresAt=Date.now()+7*86400_000;
    s.db.prepare('INSERT INTO registration_invites VALUES(?,?,NULL,?)').run(digest(code),expiresAt,principalOf(req)!.id);
    res.status(201).json({code,expiresAt});
  });
  routes.patch('/admin/users/:id',(req,res)=>{
    const input=z.object({role:z.enum(['admin','user']).optional(),banned:z.boolean().optional()}).strict().safeParse(req.body);
    if(!input.success){deny(res,400);return;}
    const target=s.db.prepare('SELECT id,role,banned FROM users WHERE id=?').get(String(req.params.id)) as {id:string;role:string;banned:number}|undefined;
    if(!target){res.status(404).json({error:'Not found'});return;}
    const admins=(s.db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND banned=0").get() as {n:number}).n;
    if(target.role==='admin' && !target.banned && admins<=1 && (input.data.role==='user'||input.data.banned)){res.status(409).json({error:'Keep at least one active administrator'});return;}
    s.db.transaction(()=>{
      s.db.prepare('UPDATE users SET role=?,banned=? WHERE id=?').run(input.data.role??target.role,input.data.banned===undefined?target.banned:Number(input.data.banned),target.id);
      s.db.prepare('DELETE FROM auth_sessions WHERE userId=?').run(target.id);
      s.db.prepare('DELETE FROM auth_daw_keys WHERE user_id=?').run(target.id);
    })();res.json({ok:true});
  });
  routes.post('/admin/users/:id/password',async(req,res)=>{
    const parsed=z.object({password:z.string().min(12).max(128)}).safeParse(req.body);
    if(!parsed.success){deny(res,400);return;}
    try{await s.auth.api.setUserPassword({headers:fromNodeHeaders(req.headers),body:{userId:String(req.params.id),newPassword:parsed.data.password}});
      await s.auth.api.revokeUserSessions({headers:fromNodeHeaders(req.headers),body:{userId:String(req.params.id)}});
      s.db.prepare('DELETE FROM auth_daw_keys WHERE user_id=?').run(String(req.params.id));res.json({ok:true});}
    catch{res.status(400).json({error:'Password could not be reset'});}
  });
  app.use('/api/account',routes);
  app.use(['/api','/audio','/references','/listening'],authenticate);
}

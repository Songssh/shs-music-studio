import { lazy, Suspense, useState, useEffect, useRef, type FormEvent } from 'react';
import { useAuth, announceAccountChange } from '../context/AuthContext';
import { accountRequest, type AccountStatus } from './accountApi';
import './auth.css';
const MusicApp = lazy(() => import('../App'));

export function AuthGate() {
  const {isAuthenticated,isLoading,refresh} = useAuth();
  const [status,setStatus] = useState<AccountStatus|null>(null);
  const [mode,setMode] = useState<'login'|'register'>('login');
  const [visible,setVisible] = useState(false);
  const [busy,setBusy] = useState(false);
  const submitting = useRef(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  useEffect(()=>{if(!isAuthenticated) accountRequest<AccountStatus>('account/status').then(setStatus).catch(()=>setError('서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.'));},[isAuthenticated]);
  if (isLoading) return <main className="auth-screen"><p role="status">세션 확인 중…</p></main>;
  if (isAuthenticated) return <Suspense fallback={<main className="auth-screen">작업 화면을 불러오는 중…</main>}><MusicApp /></Suspense>;
  const setup = status?.setupRequired;
  const registering = setup || mode==='register';
  async function submit(event:FormEvent<HTMLFormElement>) {
    event.preventDefault(); if(submitting.current || !status) return;
    const data = new FormData(event.currentTarget);
    const email = String(data.get('email')??'').trim(), password = String(data.get('password')??'');
    if(registering && password!==data.get('confirmation')) {setError('비밀번호가 일치하지 않습니다.');return;}
    submitting.current=true;setBusy(true);setError('');setNotice('');
    try {
      if(registering) {
        await accountRequest(setup?'account/setup':'account/register', {email,password,name:String(data.get('name')??'').trim(),
          ...(setup?{setupToken:data.get('setupToken')}:{inviteCode:data.get('inviteCode')||undefined})});
      }
      await accountRequest('auth/sign-in/email',{email,password});
      announceAccountChange();
      await refresh();
    } catch(err) {
      const code=(err as {status?:number}).status;
      setError(code===429?'요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.':registering
        ?'계정을 만들 수 없습니다. 입력 내용과 초대 코드를 확인하거나 관리자에게 문의해 주세요.'
        :'로그인할 수 없습니다. 이메일과 비밀번호를 확인해 주세요.');
      accountRequest<AccountStatus>('account/status').then(setStatus).catch(()=>{});
    } finally {submitting.current=false;setBusy(false);}
  }
  return <main className="auth-screen"><section className="auth-card" aria-labelledby="auth-title">
    <div className="auth-intro"><div className="auth-brand"><span aria-hidden="true">H</span> HOT-Step</div>
      <h1 id="auth-title">{setup?'시작하기':mode==='register'?'계정 만들기':'로그인'}</h1>
      <p>{setup?'기존 음악과 데이터를 첫 관리자 계정에 연결합니다.':registering?'나만의 음악과 프로젝트를 안전하게 관리하세요.':'HOT-Step 계정으로 음악 작업을 이어가세요.'}</p>
    </div>
    <form className="auth-form" onSubmit={submit}>
      {registering && <label>사용자 이름<input name="name" autoComplete="nickname" required maxLength={80} disabled={busy}/></label>}
      <label>이메일<input name="email" type="email" autoComplete="username" required maxLength={254} disabled={busy}/></label>
      <label>비밀번호<div className="auth-password"><input name="password" type={visible?'text':'password'} autoComplete={registering?'new-password':'current-password'} required minLength={registering?12:1} maxLength={128} disabled={busy}/><button type="button" aria-pressed={visible} onClick={()=>setVisible(!visible)}>{visible?'숨기기':'표시'}</button></div></label>
      {registering && <><small>12–128자 비밀번호를 사용하세요.</small><label>비밀번호 확인<input name="confirmation" type={visible?'text':'password'} autoComplete="new-password" required minLength={12} maxLength={128} disabled={busy}/></label></>}
      {setup && <label>초기 설정 코드<input name="setupToken" required autoComplete="off" disabled={busy}/><small>서버 데이터 폴더의 auth-private/bootstrap-token 파일에서 확인할 수 있습니다.</small></label>}
      {!setup && registering && status?.registrationMode==='invite' && <label>초대 코드<input name="inviteCode" autoComplete="off" required disabled={busy}/></label>}
      {!registering && <button className="auth-link" type="button" onClick={()=>setNotice('비밀번호 재설정은 서버 관리자에게 요청해 주세요. 현재 이메일 재설정은 제공되지 않습니다.')}>비밀번호를 잊으셨나요?</button>}
      {error && <p className="auth-error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
      <div className="auth-actions">{!setup && (registering || status?.registrationMode!=='closed') && <button type="button" className="auth-link" disabled={busy} onClick={()=>{setMode(registering?'login':'register');setError('');setNotice('');}}>{registering?'로그인으로 돌아가기':'계정 만들기'}</button>}
        <button className="auth-primary" type="submit" disabled={busy||!status}>{busy?'처리 중…':setup?'관리자 설정':registering?'계정 만들기':'로그인'}</button></div>
    </form></section><footer className="auth-footer">HOT-Step · 나만의 음악 작업 공간</footer></main>;
}

export interface AccountUser { id:string; username:string; email:string; role:'admin'|'user'; banned?:number; bio?:string; avatar_url?:string; banner_url?:string; created_at?:string }
export interface AccountStatus { setupRequired:boolean; registrationMode:'open'|'invite'|'closed'; passwordReset:'administrator' }
export async function accountRequest<T>(path:string, body?:unknown, method=body===undefined?'GET':'POST'):Promise<T> {
  const result = await fetch(`/api/${path}`, { method, credentials:'same-origin', cache:'no-store',
    headers:body===undefined?{}:{'Content-Type':'application/json'}, body:body===undefined?undefined:JSON.stringify(body) });
  const data = await result.json().catch(()=>null);
  if (!result.ok) throw Object.assign(new Error(data?.error?.message ?? data?.message ?? data?.error ?? '요청을 처리하지 못했습니다.'), {status:result.status});
  return data as T;
}

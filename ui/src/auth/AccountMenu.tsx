import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { UserRound } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { accountRequest, type AccountUser } from './accountApi';

export function AccountMenu({expanded}:{expanded:boolean}) {
  const {user,logout,updateUsername}=useAuth();const dialog=useRef<HTMLDialogElement>(null);
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const [users,setUsers]=useState<AccountUser[]>([]),[mode,setMode]=useState('open');
  async function run(action:()=>Promise<void>){if(busy)return;setBusy(true);setMessage('');try{await action();}catch{setMessage('처리하지 못했습니다. 입력 내용과 권한을 확인해 주세요.');}finally{setBusy(false);}}
  async function loadAdmin(){const [list,policy]=await Promise.all([accountRequest<{users:AccountUser[]}>('account/admin/users'),accountRequest<{mode:string}>('account/admin/registration')]);setUsers(list.users);setMode(policy.mode);}
  return <><button type="button" title={`${user?.username} · 계정`} onClick={()=>{dialog.current?.showModal();if(user?.role==='admin')void run(loadAdmin);}} className={`w-full rounded-xl flex items-center gap-3 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/5 ${expanded?'px-3 py-2.5':'aspect-square justify-center'}`}><UserRound size={20}/>{expanded&&<span className="text-sm truncate">{user?.username}</span>}</button>
    {createPortal(<dialog ref={dialog} className="account-dialog" onKeyDown={e=>e.stopPropagation()}>
      <button className="account-close" aria-label="계정 창 닫기" onClick={()=>dialog.current?.close()}>×</button><h2>내 계정</h2><p>{user?.email}</p>
      <form onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void run(async()=>{await updateUsername(String(data.get('name')));setMessage('프로필을 저장했습니다.');});}}>
        <label>사용자 이름<input name="name" defaultValue={user?.username} required maxLength={80}/></label><button className="auth-primary" disabled={busy}>프로필 저장</button>
      </form><h3>비밀번호 변경</h3>
      <form onSubmit={e=>{e.preventDefault();const form=e.currentTarget,data=new FormData(form);if(data.get('newPassword')!==data.get('confirmation')){setMessage('비밀번호가 일치하지 않습니다.');return;}void run(async()=>{await accountRequest('auth/change-password',{currentPassword:data.get('currentPassword'),newPassword:data.get('newPassword'),revokeOtherSessions:true});form.reset();setMessage('비밀번호를 변경하고 다른 기기의 세션을 종료했습니다.');});}}>
        <label>현재 비밀번호<input type="password" name="currentPassword" autoComplete="current-password" required/></label>
        <label>새 비밀번호 (12–128자)<input type="password" name="newPassword" autoComplete="new-password" required minLength={12} maxLength={128}/></label>
        <label>새 비밀번호 확인<input type="password" name="confirmation" autoComplete="new-password" required minLength={12} maxLength={128}/></label><button className="auth-primary" disabled={busy}>비밀번호 변경</button>
      </form>
      <h3>DAW 연결</h3><p>개인 연결 키는 30일 동안 DAW API에서만 사용할 수 있습니다.</p>
      <button className="auth-link" disabled={busy} onClick={()=>void run(async()=>{const result=await accountRequest<{key:string}>('account/daw-key',{});setMessage(`개인 DAW 키 (한 번만 표시): ${result.key}`);})}>연결 키 발급·교체</button>
      <button className="auth-link" disabled={busy} onClick={()=>void run(async()=>{await accountRequest('account/daw-key',undefined,'DELETE');setMessage('개인 DAW 키를 폐기했습니다.');})}>연결 키 폐기</button>
      {user?.role==='admin'&&<section><h3>사용자 관리</h3><label>회원가입 정책<select value={mode} disabled={busy} onChange={e=>{const value=e.target.value;void run(async()=>{await accountRequest('account/admin/registration',{mode:value},'PUT');setMode(value);});}}><option value="open">Open · 누구나 가입</option><option value="invite">Invite · 초대 코드</option><option value="closed">Closed · 가입 중지</option></select></label>
        <button type="button" className="auth-link" disabled={busy} onClick={()=>void run(async()=>{const result=await accountRequest<{code:string}>('account/admin/invitations',{});setMessage(`초대 코드 (7일, 한 번 사용): ${result.code}`);})}>초대 코드 만들기</button>
        {users.map(item=><div className="account-user" key={item.id}><span>{item.username}<br/><small>{item.email}</small></span><select aria-label={`${item.username} 권한`} value={item.role} disabled={busy} onChange={e=>{const role=e.target.value;void run(async()=>{await accountRequest(`account/admin/users/${encodeURIComponent(item.id)}`,{role},'PATCH');await loadAdmin();});}}><option value="user">User</option><option value="admin">Administrator</option></select>
          <button className="auth-link" disabled={busy} onClick={()=>void run(async()=>{await accountRequest(`account/admin/users/${encodeURIComponent(item.id)}`,{banned:!item.banned},'PATCH');await loadAdmin();})}>{item.banned?'사용 허용':'사용 중지'}</button></div>)}
        <form onSubmit={e=>{e.preventDefault();const form=e.currentTarget,data=new FormData(form);void run(async()=>{await accountRequest(`account/admin/users/${encodeURIComponent(String(data.get('user')))}/password`,{password:data.get('password')});form.reset();setMessage('비밀번호를 재설정하고 해당 사용자의 세션을 종료했습니다. 새 비밀번호를 안전한 방법으로 전달해 주세요.');});}}>
          <label>재설정할 계정<select name="user" required>{users.map(item=><option key={item.id} value={item.id}>{item.email}</option>)}</select></label><label>새 비밀번호<input type="password" name="password" autoComplete="new-password" minLength={12} maxLength={128} required/></label><button className="auth-primary" disabled={busy}>관리자 비밀번호 재설정</button>
        </form><h3>기존 학습·LoRA 폴더 연결</h3><form onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void run(async()=>{await accountRequest('account/admin/folders',{folder:data.get('folder'),userId:data.get('owner')});setMessage('폴더 소유자를 등록했습니다. 기존 폴더 선택기에서 해당 경로를 사용할 수 있습니다.');});}}>
          <label>소유 계정<select name="owner" required>{users.map(item=><option key={item.id} value={item.id}>{item.email}</option>)}</select></label><label>서버의 기존 폴더 경로<input name="folder" required/></label><button className="auth-primary" disabled={busy}>폴더 연결</button>
        </form></section>}
      {message&&<p role="status">{message}</p>}<button className="auth-link" disabled={busy} onClick={()=>void run(logout)}>로그아웃</button>
    </dialog>,document.body)}</>;
}

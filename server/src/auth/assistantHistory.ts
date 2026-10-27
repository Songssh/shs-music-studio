import { getDb } from '../db/database.js';
import { ownerId } from './principal.js';
import { randomUUID } from 'node:crypto';

export function assistantHistory() {
  return getDb().prepare('SELECT id,role,content,status FROM (SELECT rowid,id,role,content,status FROM assistant_messages WHERE user_id=? ORDER BY rowid DESC LIMIT 200) ORDER BY rowid').all(ownerId());
}
export function beginAssistantTurn(message:string):string {
  const id=randomUUID(),user=ownerId();
  getDb().transaction(()=>{
    const insert=getDb().prepare('INSERT INTO assistant_messages(id,user_id,role,content,status) VALUES(?,?,?,?,?)');
    insert.run(randomUUID(),user,'user',message,'complete');
    insert.run(id,user,'assistant','','streaming');
  })();return id;
}
export function updateAssistantTurn(id:string,content:string,status='streaming') {
  getDb().prepare('UPDATE assistant_messages SET content=?,status=? WHERE id=? AND user_id=?').run(content,status,id,ownerId());
}
export function clearAssistantHistory(){getDb().prepare('DELETE FROM assistant_messages WHERE user_id=?').run(ownerId());}

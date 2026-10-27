import fs from 'node:fs';
import path from 'node:path';
import type Database from 'better-sqlite3';
import { AssetOwnership } from './assets.js';
import { principalOf } from './principal.js';

/** Run on the backed-up development copy. Never move or delete a source file. */
export function migrateOwnership(db:Database.Database,dataDir:string):void {
  db.function('hotstep_owner',()=>principalOf()?.id??null);
  const tables=new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {name:string}[]).map(r=>r.name));
  const state=db.prepare('SELECT legacy_user_id FROM registration_settings WHERE id=1').get() as {legacy_user_id:string|null};
  const roots=['artists','training_datasets','compare_sessions'];
  db.transaction(()=>{
    for(const table of roots){if(!tables.has(table))continue;
      const cols=db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[];
      if(!cols.some(c=>c.name==='user_id'))db.exec(`ALTER TABLE ${table} ADD COLUMN user_id TEXT REFERENCES users(id)`);
      db.exec(`CREATE INDEX IF NOT EXISTS ${table}_owner ON ${table}(user_id);
        CREATE TRIGGER IF NOT EXISTS ${table}_assign_owner AFTER INSERT ON ${table} WHEN NEW.user_id IS NULL
        BEGIN SELECT CASE WHEN hotstep_owner() IS NULL THEN RAISE(ABORT,'Personal resource requires an owner') END;
          UPDATE ${table} SET user_id=hotstep_owner() WHERE id=NEW.id; END;`);
    }
    if(db.prepare('SELECT 1 FROM auth_migrations WHERE version=2').get())return;
    if(state.legacy_user_id){
      for(const table of roots)if(tables.has(table))db.prepare(`UPDATE ${table} SET user_id=? WHERE user_id IS NULL`).run(state.legacy_user_id);
    }else for(const table of roots)if(tables.has(table)&&(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as {n:number}).n)throw new Error('Existing resources have no legacy owner; explicit recovery mapping required');
    db.prepare('INSERT INTO auth_migrations VALUES(2,?)').run(new Date().toISOString());
  })();
  if(tables.has('artists')){
    const columns=db.prepare('PRAGMA table_info(artists)').all() as {name:string}[];
    if(!columns.some(c=>c.name==='display_name')){
      db.exec('ALTER TABLE artists ADD COLUMN display_name TEXT');
      db.exec('DROP VIEW IF EXISTS auth_owned_artists');
    }
    const selected=(db.prepare('PRAGMA table_info(artists)').all() as {name:string}[]).map(c=>c.name==='name'?'COALESCE(display_name,name) AS name':`"${c.name}"`).join(',');
    db.exec(`CREATE VIEW IF NOT EXISTS auth_owned_artists AS SELECT ${selected} FROM artists WHERE user_id=hotstep_owner()`);
  }
  if(!db.prepare('SELECT 1 FROM auth_migrations WHERE version=4').get())db.transaction(()=>{
    if(state.legacy_user_id){
      for(const table of ['workflow_documents','document_import_receipts'])if(tables.has(table))db.prepare(`UPDATE ${table} SET user_id=? WHERE user_id='@installation' AND kind LIKE 'preferences.%'`).run(state.legacy_user_id);
      if(tables.has('settings'))db.prepare("INSERT OR IGNORE INTO settings(key,value) SELECT 'training_defaults_v1:'||?,value FROM settings WHERE key='training_defaults_v1'").run(state.legacy_user_id);
      if(tables.has('audio_assets'))db.prepare('UPDATE audio_assets SET user_id=? WHERE user_id IS NULL').run(state.legacy_user_id);
    }
    db.prepare('INSERT INTO auth_migrations VALUES(4,?)').run(new Date().toISOString());
  })();
  // Explicit read views keep legacy integer IDs and foreign keys. Every view resolves
  // ownership from the request/job context, including children reached through joins.
  if(['artists','lyrics_sets','profiles','generations','audio_generations','album_presets'].every(table=>tables.has(table))) db.exec(`CREATE VIEW IF NOT EXISTS auth_owned_artists AS SELECT * FROM artists WHERE user_id=hotstep_owner();
    CREATE VIEW IF NOT EXISTS auth_owned_lyrics_sets AS SELECT * FROM lyrics_sets WHERE artist_id IN (SELECT id FROM auth_owned_artists);
    CREATE VIEW IF NOT EXISTS auth_owned_profiles AS SELECT * FROM profiles WHERE lyrics_set_id IN (SELECT id FROM auth_owned_lyrics_sets);
    CREATE VIEW IF NOT EXISTS auth_owned_generations AS SELECT * FROM generations WHERE profile_id IN (SELECT id FROM auth_owned_profiles);
    CREATE VIEW IF NOT EXISTS auth_owned_audio_generations AS SELECT * FROM audio_generations WHERE generation_id IN (SELECT id FROM auth_owned_generations);
    CREATE VIEW IF NOT EXISTS auth_owned_album_presets AS SELECT * FROM album_presets WHERE lyrics_set_id IN (SELECT id FROM auth_owned_lyrics_sets);`);
  const children:Record<string,[string,string]>={lyrics_sets:['artist_id','artists'],profiles:['lyrics_set_id','lyrics_sets'],
    generations:['profile_id','profiles'],album_presets:['lyrics_set_id','lyrics_sets'],audio_generations:['generation_id','generations']};
  for(const [table,[column,parent]] of Object.entries(children)){if(!tables.has(table))continue;
    const pk=table==='album_presets'?'lyrics_set_id':'id';
    db.exec(`DROP TRIGGER IF EXISTS ${table}_auth_update; CREATE TRIGGER IF NOT EXISTS ${table}_auth_insert BEFORE INSERT ON ${table}
      WHEN NOT EXISTS(SELECT 1 FROM auth_owned_${parent} WHERE id=NEW.${column}) BEGIN SELECT RAISE(ABORT,'Resource not found'); END;
      CREATE TRIGGER IF NOT EXISTS ${table}_auth_update BEFORE UPDATE ON ${table}
      WHEN NOT EXISTS(SELECT 1 FROM auth_owned_${table} WHERE ${pk}=OLD.${pk}) OR NOT EXISTS(SELECT 1 FROM auth_owned_${parent} WHERE id=NEW.${column})
      BEGIN SELECT RAISE(ABORT,'Resource not found'); END;`);
  }
  if(!db.prepare('SELECT 1 FROM auth_migrations WHERE version=5').get())db.transaction(()=>{
    if(state.legacy_user_id){
      const assets=new AssetOwnership(db,dataDir);
      if(tables.has('training_datasets'))for(const row of db.prepare('SELECT source_dir,slug FROM training_datasets WHERE user_id=?').all(state.legacy_user_id) as {source_dir:string;slug:string}[]){
        if(row.source_dir&&fs.existsSync(row.source_dir))assets.register(row.source_dir,state.legacy_user_id,'directory');
        const output=path.join(process.env.TRAINING_DIR||path.join(dataDir,'training'),row.slug);
        if(fs.existsSync(output))assets.register(output,state.legacy_user_id,'directory');
      }
      for(const [folder,kind] of [['pipelines','pipeline'],['yue2-batches','yue2-batch']]){
        const dir=path.join(process.env.TRAINING_DIR||path.join(dataDir,'training'),folder);
        if(fs.existsSync(dir))for(const file of fs.readdirSync(dir).filter(f=>f.endsWith('.json'))){
          try{const record=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));if(typeof record.id==='string')db.prepare('INSERT OR IGNORE INTO resource_owners VALUES(?,?,?)').run(kind,record.id,state.legacy_user_id);}catch{/* Leave unreadable records intact for recovery. */}
        }
      }
    }
    db.prepare('INSERT INTO auth_migrations VALUES(5,?)').run(new Date().toISOString());
  })();
  if(db.prepare('SELECT 1 FROM auth_migrations WHERE version=3').get())return;
  if(state.legacy_user_id){
    const assets=new AssetOwnership(db,dataDir);
    const visit=(dir:string)=>{if(!fs.existsSync(dir))return;for(const item of fs.readdirSync(dir,{withFileTypes:true})){
      const file=path.join(dir,item.name);if(item.isSymbolicLink())continue;
      if(item.isDirectory())visit(file);else if(item.isFile())assets.register(file,state.legacy_user_id!);
    }};
    db.transaction(()=>{for(const folder of ['audio','references','stems','midi','training','vst'])visit(path.join(dataDir,folder));
      for(const [folder,kind] of [['stems','stem'],['midi','midi']]){const dir=path.join(dataDir,folder);if(fs.existsSync(dir))for(const item of fs.readdirSync(dir,{withFileTypes:true}))if(item.isDirectory()&&!item.isSymbolicLink())db.prepare('INSERT OR IGNORE INTO resource_owners VALUES(?,?,?)').run(kind,item.name,state.legacy_user_id);}
      db.prepare('INSERT INTO auth_migrations VALUES(3,?)').run(new Date().toISOString());})();
  }else db.prepare('INSERT INTO auth_migrations VALUES(3,?)').run(new Date().toISOString());
}

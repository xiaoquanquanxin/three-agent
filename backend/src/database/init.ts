import Database from 'better-sqlite3';
import path from 'path';

// 数据库文件路径（在 backend 目录下）
const DB_PATH = path.join(__dirname, '../../database.db');

// 创建或连接数据库
export const db: Database.Database = new Database(DB_PATH);

// 初始化数据库表
export function initDatabase() {
  console.log('🗄️  初始化数据库...');

  // 开启外键约束
  db.pragma('foreign_keys = ON');

  // 创建 shapes 表
  db.exec(`
    CREATE TABLE IF NOT EXISTS shapes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('square', 'circle', 'triangle')),
      vertexList TEXT NOT NULL,
      position_x REAL NOT NULL,
      position_y REAL NOT NULL,
      position_z REAL NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 创建索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_type ON shapes(type);
    CREATE INDEX IF NOT EXISTS idx_created ON shapes(created_at DESC);
  `);

  console.log('✅ shapes 表创建成功');

  // 创建 shape_operations 表（用于 undo/redo）
  db.exec(`
    CREATE TABLE IF NOT EXISTS shape_operations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      shape_id TEXT,
      operation TEXT NOT NULL CHECK(operation IN ('create', 'update', 'delete')),
      before_state TEXT,
      after_state TEXT,
      undone INTEGER DEFAULT 0,
      operated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // 兼容旧表：添加 undone 字段（如果不存在）
  try {
    db.exec(`ALTER TABLE shape_operations ADD COLUMN undone INTEGER DEFAULT 0`);
    console.log('✅ 添加 undone 字段成功');
  } catch (e) {
    // 字段已存在，忽略错误
  }

  // 创建索引
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_session ON shape_operations(session_id, operated_at DESC);
  `);

  console.log('✅ shape_operations 表创建成功');

  // 查看表结构
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('📋 数据库中的表:', tables.map((t: any) => t.name).join(', '));

  console.log('✅ 数据库初始化完成！');
}

// 如果直接运行此文件，则初始化数据库
if (require.main === module) {
  initDatabase();
  db.close();
}

import { db } from './init';

// ========== Shapes 表操作 ==========

/**
 * 创建形状
 */
export function createShape(data: {
  id: string;
  type: 'square' | 'circle' | 'triangle';
  vertexList: any;
  position_x: number;
  position_y: number;
  position_z: number;
}) {
  const stmt = db.prepare(`
    INSERT INTO shapes (id, type, vertexList, position_x, position_y, position_z)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  return stmt.run(
    data.id,
    data.type,
    JSON.stringify(data.vertexList),
    data.position_x,
    data.position_y,
    data.position_z
  );
}

/**
 * 根据 ID 获取形状
 */
export function getShapeById(id: string) {
  const stmt = db.prepare('SELECT * FROM shapes WHERE id = ?');
  const shape = stmt.get(id) as any;

  if (shape) {
    shape.vertexList = JSON.parse(shape.vertexList);
  }

  return shape;
}

/**
 * 获取所有形状
 */
export function getAllShapes() {
  const stmt = db.prepare('SELECT * FROM shapes ORDER BY created_at DESC');
  const shapes = stmt.all() as any[];

  return shapes.map(shape => ({
    ...shape,
    vertexList: JSON.parse(shape.vertexList)
  }));
}

/**
 * 根据类型获取最近创建的形状
 */
export function getLastCreatedShape(type?: string, offset: number = 0) {
  let stmt;
  if (type) {
    stmt = db.prepare(`
      SELECT * FROM shapes
      WHERE type = ?
      ORDER BY created_at DESC
      LIMIT 1 OFFSET ?
    `);
    const shape = stmt.get(type, offset) as any;
    if (shape) {
      shape.vertexList = JSON.parse(shape.vertexList);
    }
    return shape;
  } else {
    stmt = db.prepare(`
      SELECT * FROM shapes
      ORDER BY created_at DESC
      LIMIT 1 OFFSET ?
    `);
    const shape = stmt.get(offset) as any;
    if (shape) {
      shape.vertexList = JSON.parse(shape.vertexList);
    }
    return shape;
  }
}

/**
 * 更新形状
 */
export function updateShape(id: string, data: {
  vertexList?: any;
  position_x?: number;
  position_y?: number;
  position_z?: number;
}) {
  const updates: string[] = [];
  const values: any[] = [];

  if (data.vertexList !== undefined) {
    updates.push('vertexList = ?');
    values.push(JSON.stringify(data.vertexList));
  }
  if (data.position_x !== undefined) {
    updates.push('position_x = ?');
    values.push(data.position_x);
  }
  if (data.position_y !== undefined) {
    updates.push('position_y = ?');
    values.push(data.position_y);
  }
  if (data.position_z !== undefined) {
    updates.push('position_z = ?');
    values.push(data.position_z);
  }

  updates.push('updated_at = CURRENT_TIMESTAMP');

  const stmt = db.prepare(`
    UPDATE shapes
    SET ${updates.join(', ')}
    WHERE id = ?
  `);

  values.push(id);
  return stmt.run(...values);
}

/**
 * 删除形状
 */
export function deleteShape(id: string) {
  const stmt = db.prepare('DELETE FROM shapes WHERE id = ?');
  return stmt.run(id);
}

// ========== Shape Operations 表操作 ==========

/**
 * 记录操作历史
 */
export function recordOperation(data: {
  session_id: string;
  shape_id?: string;
  operation: 'create' | 'update' | 'delete';
  before_state?: any;
  after_state?: any;
}) {
  const stmt = db.prepare(`
    INSERT INTO shape_operations (session_id, shape_id, operation, before_state, after_state)
    VALUES (?, ?, ?, ?, ?)
  `);

  return stmt.run(
    data.session_id,
    data.shape_id || null,
    data.operation,
    data.before_state ? JSON.stringify(data.before_state) : null,
    data.after_state ? JSON.stringify(data.after_state) : null
  );
}

/**
 * 获取会话的操作历史
 */
export function getOperationHistory(session_id: string, limit: number = 10) {
  const stmt = db.prepare(`
    SELECT * FROM shape_operations
    WHERE session_id = ?
    ORDER BY operated_at DESC
    LIMIT ?
  `);

  const operations = stmt.all(session_id, limit) as any[];

  return operations.map(op => ({
    ...op,
    before_state: op.before_state ? JSON.parse(op.before_state) : null,
    after_state: op.after_state ? JSON.parse(op.after_state) : null
  }));
}

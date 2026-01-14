import { db } from './init';

// ========== Shapes 表操作 ==========

/**
 * 创建形状
 * vertexList 包含所有几何信息：
 * - 正方形/三角形: [[x,y,z], [x,y,z], ...]
 * - 圆形: {center: [x,y,z], radius: number}
 */
export function createShape(data: {
  id: string;
  type: 'square' | 'circle' | 'triangle';
  vertexList: any;
  color?: string;
}) {
  const stmt = db.prepare(`
    INSERT INTO shapes (id, type, vertexList, color)
    VALUES (?, ?, ?, ?)
  `);

  return stmt.run(
    data.id,
    data.type,
    JSON.stringify(data.vertexList),
    data.color || '#00ff88'
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
  color?: string;
}) {
  const updates: string[] = [];
  const values: any[] = [];

  if (data.vertexList !== undefined) {
    updates.push('vertexList = ?');
    values.push(JSON.stringify(data.vertexList));
  }

  if (data.color !== undefined) {
    updates.push('color = ?');
    values.push(data.color);
  }

  if (updates.length === 0) {
    return { changes: 0 };
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

// ========== Undo/Redo 操作 ==========

/**
 * 获取最近一条可撤销的操作（未被撤销的）
 */
export function getLastUndoableOperation(session_id: string) {
  // 暂时不限制 session_id，查询所有操作
  const stmt = db.prepare(`
    SELECT * FROM shape_operations
    WHERE undone = 0
    ORDER BY operated_at DESC
    LIMIT 1
  `);

  const op = stmt.get() as any;
  if (op) {
    op.before_state = op.before_state ? JSON.parse(op.before_state) : null;
    op.after_state = op.after_state ? JSON.parse(op.after_state) : null;
  }
  return op;
}

/**
 * 获取最近一条可重做的操作（已被撤销的）
 */
export function getLastRedoableOperation(session_id: string) {
  // 暂时不限制 session_id，查询所有操作
  const stmt = db.prepare(`
    SELECT * FROM shape_operations
    WHERE undone = 1
    ORDER BY operated_at DESC
    LIMIT 1
  `);

  const op = stmt.get() as any;
  if (op) {
    op.before_state = op.before_state ? JSON.parse(op.before_state) : null;
    op.after_state = op.after_state ? JSON.parse(op.after_state) : null;
  }
  return op;
}

/**
 * 标记操作为已撤销
 */
export function markOperationUndone(operationId: number) {
  const stmt = db.prepare(`
    UPDATE shape_operations SET undone = 1 WHERE id = ?
  `);
  return stmt.run(operationId);
}

/**
 * 标记操作为未撤销（重做）
 */
export function markOperationRedone(operationId: number) {
  const stmt = db.prepare(`
    UPDATE shape_operations SET undone = 0 WHERE id = ?
  `);
  return stmt.run(operationId);
}

/**
 * 执行 Undo 操作
 */
export function executeUndo(session_id: string): { success: boolean; message: string; shape?: any } {
  const op = getLastUndoableOperation(session_id);
  
  if (!op) {
    return { success: false, message: '没有可撤销的操作' };
  }

  // 根据操作类型执行反向操作
  if (op.operation === 'create') {
    // 撤销创建 = 删除
    deleteShape(op.shape_id);
    markOperationUndone(op.id);
    return { success: true, message: '已撤销创建操作', shape: { id: op.shape_id, action: 'delete' } };
  } else if (op.operation === 'delete') {
    // 撤销删除 = 恢复
    const beforeState = op.before_state;
    createShape({
      id: beforeState.id,
      type: beforeState.type,
      vertexList: beforeState.vertexList,
    });
    markOperationUndone(op.id);
    return { success: true, message: '已撤销删除操作', shape: { ...beforeState, action: 'create' } };
  } else if (op.operation === 'update') {
    // 撤销修改 = 恢复到 before_state
    const beforeState = op.before_state;
    updateShape(op.shape_id, {
      vertexList: beforeState.vertexList,
    });
    markOperationUndone(op.id);
    return { success: true, message: '已撤销修改操作', shape: { ...beforeState, action: 'update' } };
  }

  return { success: false, message: '未知操作类型' };
}

/**
 * 执行 Redo 操作
 */
export function executeRedo(session_id: string): { success: boolean; message: string; shape?: any } {
  const op = getLastRedoableOperation(session_id);
  
  if (!op) {
    return { success: false, message: '没有可重做的操作' };
  }

  // 根据操作类型重新执行
  if (op.operation === 'create') {
    // 重做创建 = 创建
    const afterState = op.after_state;
    createShape({
      id: afterState.id,
      type: afterState.type,
      vertexList: afterState.vertexList,
    });
    markOperationRedone(op.id);
    return { success: true, message: '已重做创建操作', shape: { ...afterState, action: 'create' } };
  } else if (op.operation === 'delete') {
    // 重做删除 = 删除
    deleteShape(op.shape_id);
    markOperationRedone(op.id);
    return { success: true, message: '已重做删除操作', shape: { id: op.shape_id, action: 'delete' } };
  } else if (op.operation === 'update') {
    // 重做修改 = 应用 after_state
    const afterState = op.after_state;
    updateShape(op.shape_id, {
      vertexList: afterState.vertexList,
    });
    markOperationRedone(op.id);
    return { success: true, message: '已重做修改操作', shape: { ...afterState, action: 'update' } };
  }

  return { success: false, message: '未知操作类型' };
}

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
 * 根据类型获取最近创建的 N 个形状
 */
export function getLastCreatedShapes(type: string, count: number = 1) {
  const stmt = db.prepare(`
    SELECT * FROM shapes
    WHERE type = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);
  const shapes = stmt.all(type, count) as any[];
  return shapes.map(shape => ({
    ...shape,
    vertexList: JSON.parse(shape.vertexList)
  }));
}

/**
 * 根据类型获取所有形状
 */
export function getShapesByType(type: string) {
  const stmt = db.prepare(`
    SELECT * FROM shapes
    WHERE type = ?
    ORDER BY created_at DESC
  `);
  const shapes = stmt.all(type) as any[];
  return shapes.map(shape => ({
    ...shape,
    vertexList: JSON.parse(shape.vertexList)
  }));
}

/**
 * 根据类型和颜色获取形状
 */
export function getShapesByTypeAndColor(type: string, color: string) {
  // 颜色名称到十六进制的映射
  const colorMap: Record<string, string> = {
    '红色': '#ff0000', '红': '#ff0000',
    '绿色': '#00ff00', '绿': '#00ff00',
    '蓝色': '#0000ff', '蓝': '#0000ff',
    '黄色': '#ffff00', '黄': '#ffff00',
    '白色': '#ffffff', '白': '#ffffff',
    '黑色': '#000000', '黑': '#000000',
    '橙色': '#ff8800', '橙': '#ff8800',
    '紫色': '#8800ff', '紫': '#8800ff',
    '粉色': '#ff88ff', '粉': '#ff88ff',
  };
  
  const hexColor = colorMap[color] || color;
  
  const stmt = db.prepare(`
    SELECT * FROM shapes
    WHERE type = ? AND color = ?
    ORDER BY created_at DESC
  `);
  const shapes = stmt.all(type, hexColor) as any[];
  return shapes.map(shape => ({
    ...shape,
    vertexList: JSON.parse(shape.vertexList)
  }));
}

/**
 * 获取形状数量统计
 */
export function getShapeCounts(): Record<string, number> {
  const stmt = db.prepare(`
    SELECT type, COUNT(*) as count FROM shapes GROUP BY type
  `);
  const results = stmt.all() as any[];
  const counts: Record<string, number> = {};
  for (const r of results) {
    counts[r.type] = r.count;
  }
  return counts;
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
  batch_id?: string;
}) {
  const stmt = db.prepare(`
    INSERT INTO shape_operations (session_id, shape_id, operation, before_state, after_state, batch_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  return stmt.run(
    data.session_id,
    data.shape_id || null,
    data.operation,
    data.before_state ? JSON.stringify(data.before_state) : null,
    data.after_state ? JSON.stringify(data.after_state) : null,
    data.batch_id || null
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
 * 如果有 batch_id，返回整个批次
 */
export function getLastUndoableOperation(session_id: string) {
  // 先获取最近一条未撤销的操作
  const stmt = db.prepare(`
    SELECT * FROM shape_operations
    WHERE undone = 0
    ORDER BY operated_at DESC
    LIMIT 1
  `);

  const op = stmt.get() as any;
  if (!op) return null;

  // 如果有 batch_id，获取整个批次
  if (op.batch_id) {
    const batchStmt = db.prepare(`
      SELECT * FROM shape_operations
      WHERE batch_id = ? AND undone = 0
      ORDER BY operated_at DESC
    `);
    const batchOps = batchStmt.all(op.batch_id) as any[];
    return batchOps.map(o => ({
      ...o,
      before_state: o.before_state ? JSON.parse(o.before_state) : null,
      after_state: o.after_state ? JSON.parse(o.after_state) : null,
    }));
  }

  // 单条操作
  op.before_state = op.before_state ? JSON.parse(op.before_state) : null;
  op.after_state = op.after_state ? JSON.parse(op.after_state) : null;
  return [op];
}

/**
 * 获取最近一条可重做的操作（已被撤销的）
 * 如果有 batch_id，返回整个批次
 */
export function getLastRedoableOperation(session_id: string) {
  // 先获取最近一条已撤销的操作
  const stmt = db.prepare(`
    SELECT * FROM shape_operations
    WHERE undone = 1
    ORDER BY operated_at DESC
    LIMIT 1
  `);

  const op = stmt.get() as any;
  if (!op) return null;

  // 如果有 batch_id，获取整个批次
  if (op.batch_id) {
    const batchStmt = db.prepare(`
      SELECT * FROM shape_operations
      WHERE batch_id = ? AND undone = 1
      ORDER BY operated_at ASC
    `);
    const batchOps = batchStmt.all(op.batch_id) as any[];
    return batchOps.map(o => ({
      ...o,
      before_state: o.before_state ? JSON.parse(o.before_state) : null,
      after_state: o.after_state ? JSON.parse(o.after_state) : null,
    }));
  }

  // 单条操作
  op.before_state = op.before_state ? JSON.parse(op.before_state) : null;
  op.after_state = op.after_state ? JSON.parse(op.after_state) : null;
  return [op];
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
 * 执行 Undo 操作（支持批量）
 */
export function executeUndo(session_id: string): { success: boolean; message: string; shapes?: any[] } {
  const ops = getLastUndoableOperation(session_id);
  
  if (!ops || ops.length === 0) {
    return { success: false, message: '没有可撤销的操作' };
  }

  const shapes: any[] = [];

  // 批量撤销
  for (const op of ops) {
    if (op.operation === 'create') {
      // 撤销创建 = 删除
      deleteShape(op.shape_id);
      markOperationUndone(op.id);
      shapes.push({ id: op.shape_id, action: 'delete' });
    } else if (op.operation === 'delete') {
      // 撤销删除 = 恢复（先检查是否已存在）
      const beforeState = op.before_state;
      const existing = getShapeById(beforeState.id);
      if (!existing) {
        createShape({
          id: beforeState.id,
          type: beforeState.type,
          vertexList: beforeState.vertexList,
          color: beforeState.color,
        });
        shapes.push({ ...beforeState, action: 'create' });
      }
      markOperationUndone(op.id);
    } else if (op.operation === 'update') {
      // 撤销修改 = 恢复到 before_state
      const beforeState = op.before_state;
      updateShape(op.shape_id, {
        vertexList: beforeState.vertexList,
        color: beforeState.color,
      });
      markOperationUndone(op.id);
      shapes.push({ ...beforeState, action: 'update' });
    }
  }

  const message = ops.length > 1 
    ? `已撤销 ${ops.length} 个操作` 
    : '已撤销操作';

  // 兼容旧接口：如果只有一个，也返回 shape 字段
  if (shapes.length === 1) {
    return { success: true, message, shapes, shape: shapes[0] } as any;
  }

  return { success: true, message, shapes };
}

/**
 * 执行 Redo 操作（支持批量）
 */
export function executeRedo(session_id: string): { success: boolean; message: string; shapes?: any[] } {
  const ops = getLastRedoableOperation(session_id);
  
  if (!ops || ops.length === 0) {
    return { success: false, message: '没有可重做的操作' };
  }

  const shapes: any[] = [];

  // 批量重做
  for (const op of ops) {
    if (op.operation === 'create') {
      // 重做创建 = 创建（先检查是否已存在）
      const afterState = op.after_state;
      const existing = getShapeById(afterState.id);
      if (!existing) {
        createShape({
          id: afterState.id,
          type: afterState.type,
          vertexList: afterState.vertexList,
          color: afterState.color,
        });
        shapes.push({ ...afterState, action: 'create' });
      }
      markOperationRedone(op.id);
    } else if (op.operation === 'delete') {
      // 重做删除 = 删除
      deleteShape(op.shape_id);
      markOperationRedone(op.id);
      shapes.push({ id: op.shape_id, action: 'delete' });
    } else if (op.operation === 'update') {
      // 重做修改 = 应用 after_state
      const afterState = op.after_state;
      updateShape(op.shape_id, {
        vertexList: afterState.vertexList,
        color: afterState.color,
      });
      markOperationRedone(op.id);
      shapes.push({ ...afterState, action: 'update' });
    }
  }

  const message = ops.length > 1 
    ? `已重做 ${ops.length} 个操作` 
    : '已重做操作';

  // 兼容旧接口：如果只有一个，也返回 shape 字段
  if (shapes.length === 1) {
    return { success: true, message, shapes, shape: shapes[0] } as any;
  }

  return { success: true, message, shapes };
}

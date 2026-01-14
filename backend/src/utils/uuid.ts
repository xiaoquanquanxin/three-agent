import { v4 as uuidv4 } from 'uuid';
import { getShapeById } from '../database/operations';

/**
 * 生成 UUID（确保不与数据库中已有 ID 重复）
 */
export function generateId(): string {
  let id = uuidv4();
  // 检查是否重复，重复则重新生成（极小概率）
  while (getShapeById(id)) {
    id = uuidv4();
  }
  return id;
}

/**
 * 生成纯 UUID（不检查数据库，用于 batch_id 等）
 */
export function generatePureId(): string {
  return uuidv4();
}

/**
 * 验证 UUID 格式
 */
export function isValidUUID(id: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

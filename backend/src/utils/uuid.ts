import { v4 as uuidv4 } from 'uuid';

/**
 * 生成 UUID
 */
export function generateId(): string {
  return uuidv4();
}

/**
 * 验证 UUID 格式
 */
export function isValidUUID(id: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

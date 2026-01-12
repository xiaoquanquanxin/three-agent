import dotenv from 'dotenv';
import path from 'path';

// 加载根目录的 .env 文件
dotenv.config({ path: path.join(__dirname, '../../../.env') });

// 环境变量配置
export const config = {
  // LLM API 配置（阿里云通义千问）
  apiKey: process.env.API_KEY || process.env.OPENAI_API_KEY || '',
  baseURL: process.env.BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  modelName: process.env.MODEL_NAME || 'qwen-max',

  // 服务器配置
  port: parseInt(process.env.PORT || '3001', 10),

  // 数据库配置
  databasePath: process.env.DATABASE_URL || 'file:./database.db',
};

// 验证必需的环境变量
export function validateConfig() {
  const missing: string[] = [];

  if (!config.apiKey) {
    missing.push('API_KEY 或 OPENAI_API_KEY');
  }

  if (missing.length > 0) {
    throw new Error(`缺少必需的环境变量: ${missing.join(', ')}`);
  }

  console.log('✅ 环境变量配置验证通过');
}

// 打印配置信息（隐藏敏感信息）
export function printConfig() {
  console.log('📋 配置信息:');
  console.log(`  - API Key: ${config.apiKey.substring(0, 10)}...`);
  console.log(`  - Base URL: ${config.baseURL}`);
  console.log(`  - Model: ${config.modelName}`);
  console.log(`  - Port: ${config.port}`);
  console.log(`  - Database: ${config.databasePath}`);
}

import dotenv from 'dotenv';

dotenv.config();

// API 密钥
export const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// 智能体配置
export const SUPERVISOR_MODEL = "gpt-4";
export const SUPERVISOR_TEMPERATURE = 0;
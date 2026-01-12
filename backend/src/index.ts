import express from 'express';
import cors from 'cors';
import { config, validateConfig, printConfig } from './config/settings';
import { initDatabase } from './database/init';
import apiRoutes from './api/routes';

// 初始化 Express 应用
const app = express();

// 中间件
app.use(cors());
app.use(express.json());

// 测试路由
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Three-Agent Backend is running' });
});

// API 路由
app.use('/api', apiRoutes);

// 启动服务器
async function startServer() {
  try {
    console.log('🚀 启动 Three-Agent 后端服务...\n');

    // 验证配置
    validateConfig();
    printConfig();

    // 初始化数据库
    console.log('\n📦 初始化数据库...');
    initDatabase();

    // 启动服务器
    app.listen(config.port, () => {
      console.log(`\n✅ 服务器运行在: http://localhost:${config.port}`);
      console.log(`   健康检查: http://localhost:${config.port}/health\n`);
    });
  } catch (error) {
    console.error('❌ 启动失败:', error);
    process.exit(1);
  }
}

startServer();

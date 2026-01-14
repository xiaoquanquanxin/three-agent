import { ChatOpenAI } from '@langchain/openai';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { Command } from '@langchain/langgraph';
import { AgentState } from '../types';
import { config } from '../config/settings';
import { getAllShapes } from '../database/operations';

/**
 * 创建 QueryAgent
 * 职责：查询对象信息
 */
export function createQueryAgent() {
  const llm = new ChatOpenAI({
    modelName: config.modelName,
    temperature: 0.1,
    openAIApiKey: config.apiKey,
    configuration: {
      baseURL: config.baseURL,
    },
  });

  const systemPrompt = `你是一个专门处理查询几何对象的智能体。

必须只返回 JSON 格式，不要有任何其他文字！

返回 JSON 格式：
{
  "queryType": "count",
  "filters": {}
}

字段说明：
- queryType: 查询类型
  - "count": 统计数量（"有几个对象"）
  - "list": 列出对象（"列出所有xxx"）
- filters: 筛选条件（可选）
  - type: 形状类型（"square" | "circle" | "triangle"）
  - color: 颜色（十六进制或中文）

颜色识别：
- 红色/红 → "#ff0000"
- 绿色/绿 → "#00ff00"
- 蓝色/蓝 → "#0000ff"
- 黄色/黄 → "#ffff00"
- 白色/白 → "#ffffff"
- 黑色/黑 → "#000000"
- 橙色/橙 → "#ff8800"
- 紫色/紫 → "#8800ff"
- 粉色/粉 → "#ff88ff"

示例 1 - 统计全部：
输入："场景中有几个对象？"
输出：{"queryType": "count", "filters": {}}

示例 2 - 统计某类型：
输入："有几个三角形？"
输出：{"queryType": "count", "filters": {"type": "triangle"}}

示例 3 - 列出某颜色：
输入："列出所有红色的形状"
输出：{"queryType": "list", "filters": {"color": "#ff0000"}}

示例 4 - 列出某类型某颜色：
输入："列出所有蓝色的正方形"
输出：{"queryType": "list", "filters": {"type": "square", "color": "#0000ff"}}

示例 5 - 列出全部：
输入："列出所有对象"
输出：{"queryType": "list", "filters": {}}`;

  return async function queryAgent(
    state: AgentState
  ): Promise<Command<'supervisor'>> {
    try {
      // 获取用户请求
      let userRequest = '';
      for (let i = state.messages.length - 1; i >= 0; i--) {
        const msg = state.messages[i];
        const msgType = (msg as any).type || (msg as any)._getType?.();
        const content = String(msg.content);
        if (msgType === 'system' || content.includes('Supervisor: 路由到')) continue;
        if (msgType === 'user' || msgType === 'human') {
          userRequest = content;
          break;
        }
      }

      // 解析查询意图
      const llmMessages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(`用户说："${userRequest}"\n\n请解析这个请求，返回 JSON 格式的结果。`),
      ];

      const response = await llm.invoke(llmMessages);
      const responseContent = response.content as string;

      let parsedData = { queryType: 'count', filters: {} };
      try {
        const jsonMatch = responseContent.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsedData = JSON.parse(jsonMatch[0]);
        }
      } catch (e) {
        // 解析失败，使用默认值
      }

      console.log('✅ QueryAgent 解析结果:', parsedData);

      // 获取所有形状
      let shapes = getAllShapes();

      // 应用筛选条件
      const filters = parsedData.filters || {};
      if (filters.type) {
        shapes = shapes.filter(s => s.type === filters.type);
      }
      if (filters.color) {
        shapes = shapes.filter(s => s.color === filters.color);
      }

      // 生成响应
      let message: string;
      const typeMap: Record<string, string> = { square: '正方形', circle: '圆形', triangle: '三角形' };
      const colorMap: Record<string, string> = {
        '#ff0000': '红色', '#00ff00': '绿色', '#0000ff': '蓝色',
        '#ffff00': '黄色', '#ffffff': '白色', '#000000': '黑色',
        '#ff8800': '橙色', '#8800ff': '紫色', '#ff88ff': '粉色',
        '#00ff88': '默认绿',
      };

      if (parsedData.queryType === 'list') {
        if (shapes.length === 0) {
          const filterDesc = [];
          if (filters.color) filterDesc.push(colorMap[filters.color] || filters.color);
          if (filters.type) filterDesc.push(typeMap[filters.type] || filters.type);
          message = `没有找到${filterDesc.join('的') || ''}对象。`;
        } else {
          const items = shapes.map(s => {
            const typeName = typeMap[s.type] || s.type;
            const colorName = colorMap[s.color] || s.color;
            return `  - ${colorName}${typeName}（ID: ${s.id.slice(0, 8)}...）`;
          });
          message = `找到 ${shapes.length} 个对象：\n${items.join('\n')}`;
        }
      } else {
        // count
        if (Object.keys(filters).length === 0) {
          // 无筛选，显示统计
          const summary = shapes.reduce((acc, shape) => {
            acc[shape.type] = (acc[shape.type] || 0) + 1;
            return acc;
          }, {} as Record<string, number>);

          message = `场景中共有 ${shapes.length} 个对象：\n${Object.entries(summary)
            .map(([type, count]) => `  - ${typeMap[type] || type}: ${count} 个`)
            .join('\n')}`;
        } else {
          const filterDesc = [];
          if (filters.color) filterDesc.push(colorMap[filters.color] || filters.color);
          if (filters.type) filterDesc.push(typeMap[filters.type] || filters.type);
          message = `${filterDesc.join('的')}有 ${shapes.length} 个。`;
        }
      }

      console.log(`✅ QUERY: ${shapes.length} objects`);

      return new Command({
        goto: '__end__',
        update: {
          intent: undefined,
          tempData: {},
          messages: [
            ...state.messages,
            { role: 'assistant', content: message } as any,
          ],
        },
      });
    } catch (error) {
      return new Command({
        goto: '__end__',
        update: {
          intent: undefined,
          tempData: {},
          messages: [
            ...state.messages,
            { role: 'assistant', content: `查询失败: ${error}` } as any,
          ],
        },
      });
    }
  };
}

import { useState, useEffect, useRef } from 'react'
import { ThreeSceneRef } from './ThreeScene'
import './ChatPanel.css'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

interface ChatPanelProps {
  onShapeUpdate: React.Dispatch<React.SetStateAction<any[]>>
  sceneRef: React.RefObject<ThreeSceneRef>
}

function ChatPanel({ onShapeUpdate, sceneRef }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId] = useState(() => generateId())
  const [threadId, setThreadId] = useState<string | null>(null)
  const [savedTempData, setSavedTempData] = useState<any>(null)  // 保存 tempData 用于 continue
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 滚动到最新消息
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 初始化：获取场景中的所有形状
  useEffect(() => {
    fetchShapes()
  }, [])

  // 获取所有形状
  async function fetchShapes() {
    try {
      const response = await fetch('/api/shapes')
      const data = await response.json()
      onShapeUpdate(data.shapes || [])
    } catch (error) {
      console.error('获取形状失败:', error)
    }
  }

  // 发送消息
  async function handleSend() {
    if (!input.trim() || loading) return

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: new Date(),
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    setLoading(true)

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: input,
          sessionId,
          threadId,
        }),
      })

      const data = await response.json()

      // 检查是否是 interrupt 响应
      if (data.status === 'interrupted') {
        console.log('⏸️ 收到 interrupt，需要执行前端工具:', data.action)

        // 保存 threadId 和 tempData 用于 continue
        if (data.threadId) {
          setThreadId(data.threadId)
        }
        if (data.tempData) {
          setSavedTempData(data.tempData)
        }

        // 执行前端工具
        await handleInterrupt(data)
        return
      }

      // 正常响应
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.message || '执行完成',
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, assistantMessage])

      // 保存 threadId
      if (data.threadId) {
        setThreadId(data.threadId)
      }

      // 根据 action 更新场景
      if (data.action === 'create' && data.data) {
        // 创建对象：直接添加到场景
        console.log('✅ 收到创建响应，添加对象:', data.data)
        onShapeUpdate((prevShapes) => [...prevShapes, data.data])
      } else if (data.action === 'delete' && data.targetId) {
        // 删除对象：从场景移除
        console.log('✅ 收到删除响应，移除对象:', data.targetId)
        onShapeUpdate((prevShapes) => prevShapes.filter(s => s.id !== data.targetId))
      } else if (data.action === 'modify' && data.data) {
        // 修改对象：更新场景中的对象
        console.log('✅ 收到修改响应，更新对象:', data.data)
        onShapeUpdate((prevShapes) =>
          prevShapes.map(s => s.id === data.data.id ? data.data : s)
        )
      } else {
        // 其他情况：重新获取所有形状（兜底）
        await fetchShapes()
      }
    } catch (error) {
      console.error('发送消息失败:', error)
      const errorMessage: Message = {
        role: 'assistant',
        content: '抱歉，发生了错误',
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setLoading(false)
    }
  }

  // 处理 interrupt，执行前端工具
  async function handleInterrupt(interruptData: any) {
    const { action, params, threadId: interruptThreadId, tempData: interruptTempData } = interruptData

    console.log('🔧 执行前端工具:', action, params)

    let toolResult: any = null

    // 根据 action 调用相应的前端工具
    if (action === 'getNearbyObjects' && sceneRef.current) {
      const { x, y, z, radius } = params
      toolResult = sceneRef.current.getNearbyObjects(x, y, z, radius)
    }

    console.log('📤 工具执行结果:', toolResult)

    // 发送 continue 请求（带 toolResult和完整 tempData，不带 message）
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: interruptThreadId || threadId,
          sessionId,
          toolResult,  // 带上工具结果
          tempData: {
            ...interruptTempData,  // 使用 interrupt 响应中的 tempData（包含 operationParams）
            nearbyObjects: toolResult,  // 更新 nearbyObjects
            needsFrontendTool: false,  // 标记工具已执行
          },
          // 注意：不传 message
        }),
      })

      const data = await response.json()

      // 检查是否又返回了 interrupted（防止死循环）
      if (data.status === 'interrupted') {
        console.error('❌ Continue 请求后又收到 interrupted，停止执行以防止死循环')
        const errorMessage: Message = {
          role: 'assistant',
          content: '执行出错：陷入了 interrupt 循环',
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, errorMessage])
        setLoading(false)
        return
      }

      // 处理 continue 后的响应
      const assistantMessage: Message = {
        role: 'assistant',
        content: data.message || '执行完成',
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, assistantMessage])

      // 根据 action 更新场景
      if (data.action === 'create' && data.data) {
        console.log('✅ 收到创建响应（interrupt后），添加对象:', data.data)
        onShapeUpdate((prevShapes) => [...prevShapes, data.data])
      }
    } catch (error) {
      console.error('Continue 请求失败:', error)
      const errorMessage: Message = {
        role: 'assistant',
        content: '抱歉，恢复执行时发生错误',
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, errorMessage])
    } finally {
      setLoading(false)
    }
  }

  // 处理回车键
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="chat-panel">
      {/* 标题 */}
      <div className="chat-header">
        <h2>Three-Agent</h2>
        <p>通过对话创建 3D 场景</p>
      </div>

      {/* 消息列表 */}
      <div className="messages">
        {messages.length === 0 && (
          <div className="welcome">
            <p>👋 你好！我可以帮你创建和编辑 3D 场景。</p>
            <p>试试说：</p>
            <ul>
              <li>画一个正方形，边长5</li>
              <li>在附近绘制一个圆，半径为 10，尽量不要和正方形有重叠，画在旁边</li>
              <li>场景中有几个对象？</li>
            </ul>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div key={idx} className={`message ${msg.role}`}>
            <div className="message-avatar">
              {msg.role === 'user' ? '👤' : '🤖'}
            </div>
            <div className="message-content">
              <p>{msg.content}</p>
              <span className="message-time">
                {msg.timestamp.toLocaleTimeString()}
              </span>
            </div>
          </div>
        ))}

        {loading && (
          <div className="message assistant">
            <div className="message-avatar">🤖</div>
            <div className="message-content">
              <p className="loading">正在处理...</p>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* 输入框 */}
      <div className="input-area">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="输入你的指令..."
          disabled={loading}
          rows={2}
        />
        <button onClick={handleSend} disabled={loading || !input.trim()}>
          {loading ? '发送中...' : '发送'}
        </button>
      </div>
    </div>
  )
}

// 生成简单的 ID
function generateId() {
  return Math.random().toString(36).substring(2, 15)
}

export default ChatPanel

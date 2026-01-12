import { useState, useEffect, useRef } from 'react'
import './ChatPanel.css'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

interface ChatPanelProps {
  onShapeUpdate: (shapes: any[]) => void
}

function ChatPanel({ onShapeUpdate }: ChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId] = useState(() => generateId())
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
        }),
      })

      const data = await response.json()

      const assistantMessage: Message = {
        role: 'assistant',
        content: data.message || '执行完成',
        timestamp: new Date(),
      }

      setMessages((prev) => [...prev, assistantMessage])

      // 更新场景
      await fetchShapes()
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
              <li>"画一个正方形，边长5"</li>
              <li>"创建一个圆形，半径10"</li>
              <li>"场景中有几个对象？"</li>
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

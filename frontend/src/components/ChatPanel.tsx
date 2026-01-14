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
      const response = await fetch('/api/chat-sdk', {
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

        // 保存 threadId
        if (data.threadId) {
          setThreadId(data.threadId)
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
    const { action, params, threadId: interruptThreadId, operationParams, intent } = interruptData

    console.log('🔧 执行前端工具:', action, params)

    let toolResult: any = null

    // 根据 action 调用相应的前端工具
    if (action === 'getNearbyObjects' && sceneRef.current) {
      const { x, y, z, radius } = params
      toolResult = sceneRef.current.getNearbyObjects(x, y, z, radius)
    } else if (action === 'getObjectsByType' && sceneRef.current) {
      const { type } = params
      toolResult = sceneRef.current.getObjectsByType(type)
    } else if (action === 'getLastCreated' && sceneRef.current) {
      const { type, offset } = params
      toolResult = sceneRef.current.getLastCreated(type, offset || 0)
    }

    console.log('📤 工具执行结果:', toolResult)

    // 发送 continue 请求，传回 operationParams 和 intent
    try {
      const response = await fetch('/api/chat-sdk/continue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          threadId: interruptThreadId || threadId,
          sessionId,
          toolResult,
          operationParams,  // 传回后端保存的 operationParams
          intent,           // 传回后端保存的 intent
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

      // 根据 action 更新场景（处理所有 action 类型）
      if (data.action === 'create' && data.data) {
        console.log('✅ 收到创建响应（interrupt后），添加对象:', data.data)
        onShapeUpdate((prevShapes) => [...prevShapes, data.data])
      } else if (data.action === 'delete' && data.targetId) {
        console.log('✅ 收到删除响应（interrupt后），移除对象:', data.targetId)
        onShapeUpdate((prevShapes) => prevShapes.filter(s => s.id !== data.targetId))
      } else if (data.action === 'modify' && data.data) {
        console.log('✅ 收到修改响应（interrupt后），更新对象:', data.data)
        onShapeUpdate((prevShapes) =>
          prevShapes.map(s => s.id === data.data.id ? data.data : s)
        )
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

  // 撤销操作
  async function handleUndo() {
    if (loading) return
    setLoading(true)

    try {
      const response = await fetch('/api/undo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })

      const data = await response.json()

      if (data.success && data.shape) {
        const assistantMessage: Message = {
          role: 'assistant',
          content: data.message,
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, assistantMessage])

        // 根据 action 更新场景
        if (data.shape.action === 'delete') {
          onShapeUpdate((prevShapes) => prevShapes.filter(s => s.id !== data.shape.id))
        } else if (data.shape.action === 'create') {
          onShapeUpdate((prevShapes) => [...prevShapes, data.shape])
        } else if (data.shape.action === 'update') {
          onShapeUpdate((prevShapes) =>
            prevShapes.map(s => s.id === data.shape.id ? data.shape : s)
          )
        }
      } else {
        const assistantMessage: Message = {
          role: 'assistant',
          content: data.message || '没有可撤销的操作',
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, assistantMessage])
      }
    } catch (error) {
      console.error('Undo 失败:', error)
    } finally {
      setLoading(false)
    }
  }

  // 重做操作
  async function handleRedo() {
    if (loading) return
    setLoading(true)

    try {
      const response = await fetch('/api/redo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })

      const data = await response.json()

      if (data.success && data.shape) {
        const assistantMessage: Message = {
          role: 'assistant',
          content: data.message,
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, assistantMessage])

        // 根据 action 更新场景
        if (data.shape.action === 'delete') {
          onShapeUpdate((prevShapes) => prevShapes.filter(s => s.id !== data.shape.id))
        } else if (data.shape.action === 'create') {
          onShapeUpdate((prevShapes) => [...prevShapes, data.shape])
        } else if (data.shape.action === 'update') {
          onShapeUpdate((prevShapes) =>
            prevShapes.map(s => s.id === data.shape.id ? data.shape : s)
          )
        }
      } else {
        const assistantMessage: Message = {
          role: 'assistant',
          content: data.message || '没有可重做的操作',
          timestamp: new Date(),
        }
        setMessages((prev) => [...prev, assistantMessage])
      }
    } catch (error) {
      console.error('Redo 失败:', error)
    } finally {
      setLoading(false)
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
        <div className="action-buttons">
          <button onClick={handleUndo} disabled={loading} title="撤销 (Undo)">
            ↩️ 撤销
          </button>
          <button onClick={handleRedo} disabled={loading} title="重做 (Redo)">
            ↪️ 重做
          </button>
          <span className="button-divider">|</span>
          <button onClick={() => setInput(generateRandomSquare())} title="随机3D正方形（顶点）">
            🟦 正方形
          </button>
          <button onClick={() => setInput(generateRandomCircle())} title="随机3D圆形">
            🔵 圆形
          </button>
          <button onClick={() => setInput(generateRandomTriangle())} title="随机3D三角形（顶点）">
            🔺 三角形
          </button>
          <button onClick={() => setInput(generateRandom3DTriangle())} title="随机三角形（三边长）">
            📐 边长三角形
          </button>
        </div>
        <div className="input-row">
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
    </div>
  )
}

// 生成简单的 ID
function generateId() {
  return Math.random().toString(36).substring(2, 15)
}

// 随机颜色
const COLORS = ['红色', '绿色', '蓝色', '黄色', '橙色', '紫色', '粉色', '白色']
function randomColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)]
}

// 随机整数
function randomInt(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

// 生成随机 3D 正方形指令（4个顶点）
function generateRandomSquare() {
  const size = randomInt(5, 15)
  const x = randomInt(-15, 15)
  const y = randomInt(0, 15)
  const z = randomInt(-15, 15)
  const color = randomColor()
  // 随机选择平面方向：xz平面(水平)、xy平面(垂直前后)、yz平面(垂直左右)
  const plane = randomInt(0, 2)
  let vertices: string
  if (plane === 0) {
    // xz 平面（水平）
    vertices = `(${x},${y},${z}),(${x+size},${y},${z}),(${x+size},${y},${z+size}),(${x},${y},${z+size})`
  } else if (plane === 1) {
    // xy 平面（垂直，面向 z）
    vertices = `(${x},${y},${z}),(${x+size},${y},${z}),(${x+size},${y+size},${z}),(${x},${y+size},${z})`
  } else {
    // yz 平面（垂直，面向 x）
    vertices = `(${x},${y},${z}),(${x},${y+size},${z}),(${x},${y+size},${z+size}),(${x},${y},${z+size})`
  }
  return `画一个${color}正方形，顶点是${vertices}`
}

// 生成随机 3D 圆形指令
function generateRandomCircle() {
  const radius = randomInt(3, 12)
  const x = randomInt(-15, 15)
  const y = randomInt(0, 15)
  const z = randomInt(-15, 15)
  const color = randomColor()
  return `画一个${color}圆形，半径${radius}，位置在(${x},${y},${z})`
}

// 生成随机 3D 三角形指令（3个顶点，完全随机）
function generateRandomTriangle() {
  const x1 = randomInt(-15, 15)
  const y1 = randomInt(0, 15)
  const z1 = randomInt(-15, 15)
  const x2 = x1 + randomInt(5, 12)
  const y2 = randomInt(0, 15)
  const z2 = z1 + randomInt(-5, 5)
  const x3 = x1 + randomInt(-3, 8)
  const y3 = randomInt(0, 15)
  const z3 = z1 + randomInt(5, 12)
  const color = randomColor()
  return `画一个${color}三角形，顶点是(${x1},${y1},${z1}),(${x2},${y2},${z2}),(${x3},${y3},${z3})`
}

// 生成随机 3D 三角形指令（指定三边长）
function generateRandom3DTriangle() {
  const a = randomInt(5, 15)
  const b = randomInt(5, 15)
  // c 需要满足三角形不等式
  const minC = Math.abs(a - b) + 1
  const maxC = a + b - 1
  const c = randomInt(Math.max(minC, 5), Math.min(maxC, 15))
  const x = randomInt(-15, 15)
  const y = randomInt(0, 15)
  const z = randomInt(-15, 15)
  const color = randomColor()
  return `画一个${color}三角形，三边长${a},${b},${c}，位置在(${x},${y},${z})`
}

export default ChatPanel

import { useEffect, useRef, useImperativeHandle, forwardRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

interface ThreeSceneProps {
  shapes: any[]
}

export interface ThreeSceneRef {
  getNearbyObjects: (x: number, y: number, z: number, radius?: number) => any[]
  getObjectsByType: (type: string) => any[]
  getLastCreated: (type: string, offset?: number) => any
}

/**
 * 从 vertexList 计算形状中心点
 */
function getShapeCenter(shape: any): [number, number, number] {
  const { type, vertexList } = shape

  if (type === 'circle' && vertexList?.center) {
    return vertexList.center as [number, number, number]
  }

  if (Array.isArray(vertexList) && vertexList.length > 0) {
    // 计算所有顶点的平均值
    let sumX = 0, sumY = 0, sumZ = 0
    for (const v of vertexList) {
      sumX += v[0]
      sumY += v[1]
      sumZ += v[2]
    }
    return [
      sumX / vertexList.length,
      sumY / vertexList.length,
      sumZ / vertexList.length,
    ]
  }

  return [0, 0, 0]
}

const ThreeScene = forwardRef<ThreeSceneRef, ThreeSceneProps>(({ shapes }, ref) => {
  const mountRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const shapesMapRef = useRef<Map<string, THREE.Mesh>>(new Map())

  // 暴露方法给父组件
  useImperativeHandle(ref, () => ({
    getNearbyObjects: (x: number, y: number, z: number, radius: number = 10) => {
      console.log(`🔍 getNearbyObjects: 搜索坐标(${x}, ${y}, ${z})附近半径${radius}内的对象`)

      const targetPos = new THREE.Vector3(x, y, z)
      const results: any[] = []

      // 遍历 shapes 数据，从 vertexList 计算中心点
      shapes.forEach((shape) => {
        const center = getShapeCenter(shape)
        const shapePos = new THREE.Vector3(center[0], center[1], center[2])
        const distance = shapePos.distanceTo(targetPos)
        
        if (distance <= radius) {
          results.push({
            id: shape.id,
            type: shape.type,
            position: center,
            distance: distance,
          })
        }
      })

      // 按距离排序
      results.sort((a, b) => a.distance - b.distance)
      console.log(`✅ 找到 ${results.length} 个对象:`, results)

      return results
    },
    getObjectsByType: (type: string) => {
      console.log(`🔍 getObjectsByType: 搜索类型为 ${type} 的对象`)

      const results: any[] = []

      shapes.forEach((shape) => {
        if (shape.type === type) {
          const center = getShapeCenter(shape)
          results.push({
            id: shape.id,
            type: shape.type,
            position: center,
          })
        }
      })

      console.log(`✅ 找到 ${results.length} 个 ${type} 对象:`, results)

      return results
    },
    getLastCreated: (type: string, offset: number = 0) => {
      console.log(`🔍 getLastCreated: 查找最后创建的 ${type}，offset=${offset}`)

      // 按类型筛选
      const filtered = shapes.filter(s => s.type === type)
      
      // 按 created_at 排序（最新的在前）
      filtered.sort((a, b) => {
        const timeA = new Date(a.created_at).getTime()
        const timeB = new Date(b.created_at).getTime()
        return timeB - timeA
      })

      // 获取指定 offset 的对象
      const target = filtered[offset]

      if (!target) {
        console.log(`❌ 没有找到第 ${offset + 1} 个 ${type}`)
        return null
      }

      console.log(`✅ 找到对象:`, target.id)

      // 从 vertexList 计算中心点
      const center = getShapeCenter(target)

      return {
        id: target.id,
        type: target.type,
        position: center,
      }
    },
  }))

  // 初始化 Three.js 场景
  useEffect(() => {
    if (!mountRef.current) return

    const container = mountRef.current
    const width = container.clientWidth
    const height = container.clientHeight

    // 创建场景
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1a1a)
    sceneRef.current = scene

    // 创建相机（3D 透视相机）
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 1000)
    camera.position.set(0, 30, 30)
    camera.lookAt(0, 0, 0)
    cameraRef.current = camera

    // 创建渲染器
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(window.devicePixelRatio)
    container.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // 添加 OrbitControls（支持 3D 旋转、缩放）
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
    controls.target.set(0, 0, 0)
    controlsRef.current = controls

    // 添加网格地面
    const gridHelper = new THREE.GridHelper(200, 200, 0xaaaaaa, 0x555555)
    scene.add(gridHelper)

    // 添加坐标轴辅助
    const axesHelper = new THREE.AxesHelper(20)
    scene.add(axesHelper)

    // 添加环境光
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambientLight)

    // 添加方向光
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
    directionalLight.position.set(10, 20, 10)
    scene.add(directionalLight)

    // 渲染循环
    function animate() {
      requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    // 处理窗口大小变化
    function handleResize() {
      if (!mountRef.current) return
      const newWidth = mountRef.current.clientWidth
      const newHeight = mountRef.current.clientHeight
      camera.aspect = newWidth / newHeight
      camera.updateProjectionMatrix()
      renderer.setSize(newWidth, newHeight)
    }
    window.addEventListener('resize', handleResize)

    // 清理
    return () => {
      window.removeEventListener('resize', handleResize)
      if (mountRef.current && renderer.domElement) {
        mountRef.current.removeChild(renderer.domElement)
      }
      renderer.dispose()
    }
  }, [])

  // 更新场景中的形状
  useEffect(() => {
    if (!sceneRef.current) return

    console.log('🎨 ThreeScene: 更新场景，shapes:', shapes)

    const scene = sceneRef.current
    const shapesMap = shapesMapRef.current

    // 移除不存在的形状
    const currentIds = new Set(shapes.map((s) => s.id))
    shapesMap.forEach((mesh, id) => {
      if (!currentIds.has(id)) {
        scene.remove(mesh)
        mesh.geometry.dispose()
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach((m) => m.dispose())
        } else {
          mesh.material.dispose()
        }
        shapesMap.delete(id)
      }
    })

    // 添加或更新形状
    shapes.forEach((shape) => {
      const existingMesh = shapesMap.get(shape.id)
      
      if (!existingMesh) {
        // 创建新形状
        console.log('➕ 创建新形状:', shape.type, shape.id)
        const mesh = createShapeMesh(shape)
        if (mesh) {
          console.log('✅ Mesh 创建成功，添加到场景')
          scene.add(mesh)
          shapesMap.set(shape.id, mesh)
        } else {
          console.error('❌ Mesh 创建失败')
        }
      } else {
        // 更新已存在的形状
        console.log('🔄 更新形状:', shape.type, shape.id)
        scene.remove(existingMesh)
        existingMesh.geometry.dispose()
        if (Array.isArray(existingMesh.material)) {
          existingMesh.material.forEach((m) => m.dispose())
        } else {
          existingMesh.material.dispose()
        }
        
        const newMesh = createShapeMesh(shape)
        if (newMesh) {
          scene.add(newMesh)
          shapesMap.set(shape.id, newMesh)
        }
      }
    })
  }, [shapes])

  return <div ref={mountRef} style={{ width: '100%', height: '100%' }} />
})

ThreeScene.displayName = 'ThreeScene'

/**
 * 根据形状数据创建 Three.js Mesh
 * 所有几何信息都从 vertexList 读取
 * 支持真正的 3D 顶点坐标
 */
function createShapeMesh(shape: any): THREE.Mesh | null {
  console.log('🔨 createShapeMesh:', {
    type: shape.type,
    hasVertexList: !!shape.vertexList,
    color: shape.color,
  })

  const { type, vertexList, color } = shape

  let geometry: THREE.BufferGeometry | null = null
  
  // 解析颜色（支持十六进制字符串）
  const meshColor = color ? new THREE.Color(color) : new THREE.Color(0x00ff88)
  const material = new THREE.MeshStandardMaterial({
    color: meshColor,
    side: THREE.DoubleSide,
  })

  // 计算中心点
  const center = getShapeCenter(shape)

  if (type === 'square' && Array.isArray(vertexList)) {
    // 正方形：使用 BufferGeometry（支持 3D 顶点）
    geometry = new THREE.BufferGeometry()
    // 4个顶点，分成2个三角形
    const vertices = new Float32Array([
      // 第一个三角形
      vertexList[0][0], vertexList[0][1], vertexList[0][2],
      vertexList[1][0], vertexList[1][1], vertexList[1][2],
      vertexList[2][0], vertexList[2][1], vertexList[2][2],
      // 第二个三角形
      vertexList[0][0], vertexList[0][1], vertexList[0][2],
      vertexList[2][0], vertexList[2][1], vertexList[2][2],
      vertexList[3][0], vertexList[3][1], vertexList[3][2],
    ])
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
    geometry.computeVertexNormals()
  } else if (type === 'circle' && vertexList?.center) {
    // 圆形：使用 BufferGeometry 创建 3D 圆盘
    const radius = vertexList.radius || 5
    const segments = 32
    geometry = new THREE.BufferGeometry()
    
    // 创建圆盘顶点（中心点 + 圆周点）
    const vertices = []
    const centerPos = vertexList.center
    
    // 中心点
    vertices.push(centerPos[0], centerPos[1], centerPos[2])
    
    // 圆周点（在 XZ 平面上，Y 坐标与中心相同）
    for (let i = 0; i <= segments; i++) {
      const angle = (i / segments) * Math.PI * 2
      const x = centerPos[0] + Math.cos(angle) * radius
      const z = centerPos[2] + Math.sin(angle) * radius
      vertices.push(x, centerPos[1], z)
    }
    
    // 创建三角形索引（从中心点到圆周的扇形）
    const indices = []
    for (let i = 0; i < segments; i++) {
      indices.push(0, i + 1, i + 2)
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices), 3))
    geometry.setIndex(indices)
    geometry.computeVertexNormals()
  } else if (type === 'triangle' && Array.isArray(vertexList)) {
    // 三角形：使用 BufferGeometry（支持 3D 顶点）
    geometry = new THREE.BufferGeometry()
    const vertices = new Float32Array([
      vertexList[0][0], vertexList[0][1], vertexList[0][2],
      vertexList[1][0], vertexList[1][1], vertexList[1][2],
      vertexList[2][0], vertexList[2][1], vertexList[2][2],
    ])
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3))
    geometry.computeVertexNormals()
  }

  if (!geometry) return null

  const mesh = new THREE.Mesh(geometry, material)

  // 不再需要旋转，顶点已经是 3D 坐标
  // 稍微抬高一点避免和地面重叠
  mesh.position.set(0, 0.1, 0)

  // 存储 ID 到 userData
  mesh.userData.id = shape.id
  mesh.userData.type = type

  return mesh
}

export default ThreeScene

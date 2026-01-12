# 讨论记录 #6 - Three.js 渲染和数据格式最终确认

> 时间：2026-01-12
> 主题：Three.js 渲染方式、几何数据存储格式最终确认

---

## 一、Three.js 渲染方式确认 ✅

### 用户确认：
- ✅ **相机要 3D**（可以旋转、缩放视角）
- ✅ **渲染的图形可以是 2D**（平面形状）

### 实现方案：

#### 1. 相机设置（3D）
```typescript
// 使用透视相机
const camera = new THREE.PerspectiveCamera(
  75,                                  // FOV
  window.innerWidth / window.innerHeight,  // 宽高比
  0.1,                                 // 近裁剪面
  1000                                 // 远裁剪面
);
camera.position.set(0, 50, 50);  // 设置相机位置

// 使用 OrbitControls 支持 3D 旋转
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
```

#### 2. 图形渲染（2D 平面）

**正方形（ShapeGeometry）：**
```typescript
// 创建 2D 形状
const shape = new THREE.Shape();
shape.moveTo(-2.5, -2.5);
shape.lineTo(2.5, -2.5);
shape.lineTo(2.5, 2.5);
shape.lineTo(-2.5, 2.5);
shape.lineTo(-2.5, -2.5);

const geometry = new THREE.ShapeGeometry(shape);
const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
const mesh = new THREE.Mesh(geometry, material);

// 平放在 XZ 平面上
mesh.rotation.x = -Math.PI / 2;
mesh.position.set(x, 0, z);

scene.add(mesh);
```

**圆形（CircleGeometry）：**
```typescript
const geometry = new THREE.CircleGeometry(radius, 32);
const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
const mesh = new THREE.Mesh(geometry, material);

// 平放在 XZ 平面上
mesh.rotation.x = -Math.PI / 2;
mesh.position.set(x, 0, z);

scene.add(mesh);
```

**三角形（ShapeGeometry）：**
```typescript
const shape = new THREE.Shape();
shape.moveTo(v1.x, v1.z);
shape.lineTo(v2.x, v2.z);
shape.lineTo(v3.x, v3.z);
shape.lineTo(v1.x, v1.z);

const geometry = new THREE.ShapeGeometry(shape);
const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
const mesh = new THREE.Mesh(geometry, material);

mesh.rotation.x = -Math.PI / 2;
mesh.position.set(centerX, 0, centerZ);

scene.add(mesh);
```

---

## 二、几何数据存储格式确认 ✅

### 用户确认：
- ✅ 用一个额外的字段 **`vertexList`** 存储顶点的 JSON

### 数据库表结构更新：

```sql
CREATE TABLE shapes (
  id VARCHAR(36) PRIMARY KEY,
  type ENUM('square', 'circle', 'triangle') NOT NULL,

  -- 顶点列表（JSON）
  vertexList JSON NOT NULL,
  /* 示例：
    正方形: [[7.5, 0, 7.5], [12.5, 0, 7.5], [12.5, 0, 12.5], [7.5, 0, 12.5]]
    三角形: [[0, 0, 0], [5, 0, 0], [2.5, 0, 5]]
    圆形: {"center": [10, 0, 10], "radius": 5}  或者采样点列表
  */

  -- 中心位置（用于快速查询）
  position_x FLOAT NOT NULL,
  position_y FLOAT NOT NULL,
  position_z FLOAT NOT NULL,

  -- 元数据
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_type (type),
  INDEX idx_created (created_at DESC)
);
```

### 不同形状的 vertexList 格式：

#### 正方形：
```json
{
  "id": "square_001",
  "type": "square",
  "vertexList": [
    [7.5, 0, 7.5],   // 左下
    [12.5, 0, 7.5],  // 右下
    [12.5, 0, 12.5], // 右上
    [7.5, 0, 12.5]   // 左上
  ],
  "position_x": 10,
  "position_y": 0,
  "position_z": 10
}
```

#### 三角形：
```json
{
  "id": "triangle_001",
  "type": "triangle",
  "vertexList": [
    [0, 0, 0],
    [5, 0, 0],
    [2.5, 0, 5]
  ],
  "position_x": 2.5,
  "position_y": 0,
  "position_z": 1.67
}
```

#### 圆形（方案 A：中心点 + 半径）：
```json
{
  "id": "circle_001",
  "type": "circle",
  "vertexList": {
    "center": [10, 0, 10],
    "radius": 5
  },
  "position_x": 10,
  "position_y": 0,
  "position_z": 10
}
```

#### 圆形（方案 B：采样点列表）：
```json
{
  "id": "circle_002",
  "type": "circle",
  "vertexList": [
    [10, 0, 15],   // 0°
    [13.54, 0, 13.54],  // 45°
    [15, 0, 10],   // 90°
    // ... 更多采样点
  ],
  "position_x": 10,
  "position_y": 0,
  "position_z": 10
}
```

**建议：** 圆形使用方案 A（中心点 + 半径），更简洁高效。

---

## 三、后端创建对象的流程

### CreateAgent 创建正方形示例：

```typescript
async function createSquare(sideLength: number, centerX: number, centerZ: number) {
  const id = uuidv4();

  // 计算四个顶点
  const halfSide = sideLength / 2;
  const vertexList = [
    [centerX - halfSide, 0, centerZ - halfSide],  // 左下
    [centerX + halfSide, 0, centerZ - halfSide],  // 右下
    [centerX + halfSide, 0, centerZ + halfSide],  // 右上
    [centerX - halfSide, 0, centerZ + halfSide]   // 左上
  ];

  // 插入数据库
  await db.query(`
    INSERT INTO shapes (id, type, vertexList, position_x, position_y, position_z)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [
    id,
    'square',
    JSON.stringify(vertexList),
    centerX,
    0,
    centerZ
  ]);

  // 返回给前端
  return {
    action: "create",
    data: {
      id,
      type: "square",
      vertexList,
      position: [centerX, 0, centerZ]
    }
  };
}
```

---

## 四、前端渲染对象的流程

### 根据后端数据渲染：

```typescript
function renderShape(data: {
  id: string;
  type: string;
  vertexList: any;
  position: [number, number, number];
}) {
  let geometry;

  if (data.type === 'square') {
    // 使用 vertexList 创建 ShapeGeometry
    const shape = new THREE.Shape();
    const vertices = data.vertexList;
    shape.moveTo(vertices[0][0], vertices[0][2]);
    vertices.forEach((v, i) => {
      if (i > 0) shape.lineTo(v[0], v[2]);
    });
    shape.lineTo(vertices[0][0], vertices[0][2]);

    geometry = new THREE.ShapeGeometry(shape);

  } else if (data.type === 'circle') {
    const { radius } = data.vertexList;
    geometry = new THREE.CircleGeometry(radius, 32);

  } else if (data.type === 'triangle') {
    const vertices = data.vertexList;
    const shape = new THREE.Shape();
    shape.moveTo(vertices[0][0], vertices[0][2]);
    shape.lineTo(vertices[1][0], vertices[1][2]);
    shape.lineTo(vertices[2][0], vertices[2][2]);
    shape.lineTo(vertices[0][0], vertices[0][2]);

    geometry = new THREE.ShapeGeometry(shape);
  }

  const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
  const mesh = new THREE.Mesh(geometry, material);

  // 平放在 XZ 平面
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(data.position[0], 0, data.position[2]);

  // 存储 ID
  mesh.userData.id = data.id;
  mesh.userData.type = data.type;

  scene.add(mesh);
}
```

---

## 五、总结

### 所有核心技术决策已确认 ✅

1. **Three.js 渲染方式**：3D 相机 + 2D 平面图形
2. **几何数据存储**：使用 `vertexList` 字段存储顶点 JSON
3. **数据库表结构**：已更新，包含 vertexList 字段
4. **前后端数据流**：后端生成顶点 → 前端直接渲染

### 可以开始实现 MVP ✅

所有关键问题已明确，现在可以开始实现：
1. 创建数据库表
2. 实现后端 CreateAgent
3. 实现前端渲染逻辑
4. 联调测试

import { createRouter, createWebHashHistory } from 'vue-router'
import Layout from '@/layout/index.vue'
import { menuAllowed } from '@/permission'
import { db } from '@/mock'

/**
 * 菜单路由（侧边栏展示）
 * meta: title 标题 / icon Element Plus 图标名 / noCache 是否不缓存
 */
export const menuRoutes = [
  {
    path: '/workbench',
    name: 'Workbench',
    component: () => import('@/views/dashboard/workbench.vue'),
    meta: { title: '工作台', icon: 'Odometer' }
  },
  {
    path: '/monitor',
    name: 'Monitor',
    component: () => import('@/views/dashboard/monitor.vue'),
    meta: { title: '数据看板', icon: 'DataLine' }
  },
  {
    path: '/transport',
    meta: { title: '运输管理', icon: 'Van' },
    children: [
      {
        path: '/contract',
        name: 'Contract',
        component: () => import('@/views/contract/list.vue'),
        meta: { title: '合同管理', icon: 'Document' }
      },
      {
        path: '/plan',
        name: 'Plan',
        component: () => import('@/views/plan/list.vue'),
        meta: { title: '运输计划', icon: 'List' }
      },
      {
        path: '/dispatch',
        name: 'Dispatch',
        component: () => import('@/views/dispatch/list.vue'),
        meta: { title: '调度管理', icon: 'Position' }
      },
      {
        path: '/track',
        name: 'Track',
        component: () => import('@/views/track/index.vue'),
        meta: { title: '在途监控', icon: 'MapLocation' }
      },
      {
        path: '/exception',
        name: 'Exception',
        component: () => import('@/views/exception/list.vue'),
        meta: { title: '异常处理', icon: 'Warning' }
      }
    ]
  },
  {
    path: '/resource',
    meta: { title: '资源管理', icon: 'Box' },
    children: [
      {
        path: '/vehicle',
        name: 'Vehicle',
        component: () => import('@/views/vehicle/list.vue'),
        meta: { title: '车辆管理', icon: 'Van' }
      },
      {
        path: '/driver',
        name: 'Driver',
        component: () => import('@/views/driver/list.vue'),
        meta: { title: '司机管理', icon: 'User' }
      },
      {
        path: '/terminal',
        name: 'Terminal',
        component: () => import('@/views/terminal/list.vue'),
        meta: { title: '场站管理', icon: 'OfficeBuilding' }
      },
      {
        path: '/terminal/weighing',
        name: 'Weighing',
        component: () => import('@/views/terminal/weighing.vue'),
        meta: { title: '磅单记录', icon: 'ScaleToOriginal' }
      },
      {
        path: '/warehouse',
        name: 'Warehouse',
        component: () => import('@/views/warehouse/list.vue'),
        meta: { title: '仓储管理', icon: 'House' }
      },
      {
        path: '/warehouse/inventory',
        name: 'Inventory',
        component: () => import('@/views/warehouse/inventory.vue'),
        meta: { title: '库存管理', icon: 'Tickets' }
      },
      {
        path: '/commodity',
        name: 'Commodity',
        component: () => import('@/views/commodity/list.vue'),
        meta: { title: '商品管理', icon: 'Goods' }
      }
    ]
  },
  {
    path: '/business',
    meta: { title: '经营管理', icon: 'Money' },
    children: [
      {
        path: '/customer',
        name: 'Customer',
        component: () => import('@/views/customer/list.vue'),
        meta: { title: '客户管理', icon: 'Avatar' }
      },
      {
        path: '/settlement',
        name: 'Settlement',
        component: () => import('@/views/settlement/list.vue'),
        meta: { title: '结算管理', icon: 'Wallet' }
      },
      {
        path: '/settlement/invoice',
        name: 'Invoice',
        component: () => import('@/views/settlement/invoice.vue'),
        meta: { title: '发票管理', icon: 'Postcard' }
      },
      {
        path: '/report',
        name: 'Report',
        component: () => import('@/views/report/index.vue'),
        meta: { title: '报表中心', icon: 'DataAnalysis' }
      }
    ]
  },
  {
    path: '/safety',
    name: 'Safety',
    component: () => import('@/views/safety/index.vue'),
    meta: { title: '安全管理', icon: 'Umbrella' }
  },
  {
    path: '/system',
    meta: { title: '系统管理', icon: 'Setting' },
    children: [
      {
        path: '/system/user',
        name: 'SysUser',
        component: () => import('@/views/system/user.vue'),
        meta: { title: '用户管理', icon: 'UserFilled' }
      },
      {
        path: '/system/role',
        name: 'SysRole',
        component: () => import('@/views/system/role.vue'),
        meta: { title: '角色管理', icon: 'Lock' }
      },
      {
        path: '/system/log',
        name: 'SysLog',
        component: () => import('@/views/system/log.vue'),
        meta: { title: '操作日志', icon: 'Notebook' }
      }
    ]
  }
]

/** 隐藏路由（详情页/新增页，不出现在菜单） */
const hiddenRoutes = [
  {
    path: '/contract/create',
    name: 'ContractCreate',
    component: () => import('@/views/contract/create.vue'),
    meta: { title: '新建合同', activeMenu: '/contract' }
  },
  {
    path: '/contract/:id',
    name: 'ContractDetail',
    component: () => import('@/views/contract/detail.vue'),
    meta: { title: '合同详情', activeMenu: '/contract' }
  },
  {
    path: '/plan/create',
    name: 'PlanCreate',
    component: () => import('@/views/plan/create.vue'),
    meta: { title: '新建计划', activeMenu: '/plan' }
  },
  {
    path: '/plan/:id',
    name: 'PlanDetail',
    component: () => import('@/views/plan/detail.vue'),
    meta: { title: '计划详情', activeMenu: '/plan' }
  },
  {
    path: '/dispatch/:id',
    name: 'DispatchDetail',
    component: () => import('@/views/dispatch/detail.vue'),
    meta: { title: '调度详情', activeMenu: '/dispatch' }
  },
  {
    path: '/vehicle/:id',
    name: 'VehicleDetail',
    component: () => import('@/views/vehicle/detail.vue'),
    meta: { title: '车辆详情', activeMenu: '/vehicle' }
  },
  {
    path: '/driver/:id',
    name: 'DriverDetail',
    component: () => import('@/views/driver/detail.vue'),
    meta: { title: '司机详情', activeMenu: '/driver' }
  },
  {
    path: '/customer/:id',
    name: 'CustomerDetail',
    component: () => import('@/views/customer/detail.vue'),
    meta: { title: '客户详情', activeMenu: '/customer' }
  },
  {
    path: '/settlement/:id',
    name: 'SettlementDetail',
    component: () => import('@/views/settlement/detail.vue'),
    meta: { title: '结算详情', activeMenu: '/settlement' }
  },
  {
    // 司机端（H5 演示）：模拟司机接单/确认/电子签收，从调度详情页进入
    path: '/driver-app',
    name: 'DriverApp',
    component: () => import('@/views/driver/app.vue'),
    meta: { title: '司机端' }
  }
]

function flattenMenu(routes) {
  const res = []
  for (const r of routes) {
    if (r.children) {
      res.push(...flattenMenu(r.children))
    } else {
      res.push(r)
    }
  }
  return res
}

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/login',
      name: 'Login',
      component: () => import('@/views/login/index.vue'),
      meta: { title: '登录' }
    },
    {
      path: '/',
      component: Layout,
      redirect: '/workbench',
      children: [...flattenMenu(menuRoutes), ...hiddenRoutes]
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'NotFound',
      component: () => import('@/views/error/404.vue'),
      meta: { title: '页面不存在' }
    }
  ]
})

/** 登录守卫：未登录跳转登录页；已登录访问登录页回工作台；无菜单权限回工作台 */
router.beforeEach((to, from, next) => {
  const token = localStorage.getItem('blms_token')
  if (to.path !== '/login' && !token) {
    next({ path: '/login', query: { redirect: to.fullPath } })
    return
  }
  if (to.path === '/login' && token) {
    next('/workbench')
    return
  }
  // 菜单级权限：详情页跟随所属菜单（meta.activeMenu），其余按自身路径校验
  // /workbench 与 /driver-app（司机端演示）对所有登录角色开放
  const role = localStorage.getItem('blms_user')
    ? db.users.find((u) => u.username === localStorage.getItem('blms_user'))?.role
    : ''
  const menuPath = to.meta.activeMenu || to.path
  if (role && menuPath !== '/workbench' && menuPath !== '/driver-app' && !menuAllowed(role, menuPath)) {
    next('/workbench')
    return
  }
  next()
})

export default router

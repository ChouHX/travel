import { createRoot } from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import '@mantine/core/styles.css'
import 'leaflet/dist/leaflet.css'
import './styles.css'
import { App } from './App'
import { theme } from './theme'

// 刻意不使用 StrictMode：它会在开发模式下双调用 effect，导致 Leaflet 容器重复初始化
createRoot(document.getElementById('root')!).render(
  // 必须显式指定 light：默认值是 dark，会让 Mantine 组件（抽屉、按钮、输入框）
  // 全走暗色变量，出现"浅色页面里嵌着近黑面板"的割裂感。
  <MantineProvider theme={theme} defaultColorScheme="light">
    <App />
  </MantineProvider>,
)

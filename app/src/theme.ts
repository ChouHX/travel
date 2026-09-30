import { createTheme, type MantineColorsTuple } from '@mantine/core'

/**
 * 天蓝色系。index 6 是主色（浅色方案默认用它）。
 * 色相约 205°，饱和度偏高但不到荧光，保持清爽的可读性。
 */
const sky: MantineColorsTuple = [
  '#e8f6ff',
  '#d0ecff',
  '#a3d9ff',
  '#72c4ff',
  '#4cb2fc',
  '#32a7fa',
  '#1f9ef5',
  '#0b8ade',
  '#007ac7',
  '#0068ad',
]

/** 青蓝：与天蓝同族，用于"我的打卡"等需要区分的状态 */
const aqua: MantineColorsTuple = [
  '#e6fbfb',
  '#cdf4f4',
  '#9fe7e7',
  '#6ed8d9',
  '#4bcccc',
  '#35c2c3',
  '#23b8b9',
  '#159e9f',
  '#0a8586',
  '#006c6d',
]

/** 蓝紫：点缀色，用于"活动"与需要第三种区分的场景 */
const periwinkle: MantineColorsTuple = [
  '#eff1fe',
  '#dde2fb',
  '#b8c2f5',
  '#8f9fee',
  '#6d81e7',
  '#576de3',
  '#4a61e1',
  '#3b50c8',
  '#3146b4',
  '#253a9e',
]

export const theme = createTheme({
  primaryColor: 'sky',
  colors: { sky, aqua, periwinkle },
  white: '#ffffff',
  black: '#26333f',
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Source Han Sans SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif',
  fontFamilyMonospace: '"SF Mono", "JetBrains Mono", Menlo, Consolas, monospace',
  headings: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Source Han Sans SC", sans-serif',
    fontWeight: '600',
    sizes: {
      h1: { fontSize: '1.5rem', lineHeight: '1.3' },
      h2: { fontSize: '1.25rem', lineHeight: '1.35' },
      h3: { fontSize: '1.1rem', lineHeight: '1.4' },
    },
  },
  defaultRadius: 'lg',
  cursorType: 'pointer',
  components: {
    Button: { defaultProps: { size: 'sm' } },
    TextInput: { defaultProps: { size: 'md' } },
    Textarea: { defaultProps: { size: 'md' } },
    Select: { defaultProps: { size: 'md' } },
    Chip: { defaultProps: { size: 'sm' } },
    Modal: { defaultProps: { radius: 'lg' } },
  },
})
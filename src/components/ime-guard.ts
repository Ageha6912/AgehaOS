/**
 * CJK 输入法双重互锁守卫：组合期（拼音选词/候选窗打开）的 Enter、Escape
 * 等按键属于 IME 自身而不属于应用——直接消费会「确认候选词即发送/关闭
 * 面板」。全中文界面产品必须有这道闸。
 *
 * 双重互锁（对齐 Claude Desktop 逆向验证的同款算法）：
 * ① `isComposing`——标准信号，组合期的 keydown/keyup 上为 true；
 * ② `keyCode === 229`——兜底信号，部分引擎（旧 Safari、部分安卓 IME）在
 *    composition keydown 上恒发 229，而 isComposing 的置位时序不稳定。
 *
 * 只做「忽略动作」，不 preventDefault 组合期按键——取消 keydown 在部分
 * 引擎上会连选词一并吞掉。调用方传原生事件（React 合成事件用 .nativeEvent）。
 */
export function isImeComposing(event: { isComposing?: boolean; keyCode?: number }): boolean {
  return event.isComposing === true || event.keyCode === 229
}

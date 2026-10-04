import type { LiquidMapOptions } from './liquid-glass'

/**
 * 液态玻璃 SVG 滤镜定义（system-rails 组的 backdrop-filter 消费
 * url(#id)）：feImage 载入运行时生成的位移图（R/G 通道），feDisplacementMap
 * 按图折射 backdrop。scale = 2 × strength 与位移图编码精确对应。
 * mapUri 为空（jsdom/生成失败）不渲染——调用方此时回落 .glass-raise。
 */
export function LiquidGlassDefs({
  id,
  mapUri,
  options,
}: {
  id: string
  mapUri: string
  options: Pick<LiquidMapOptions, 'strength'>
}) {
  if (!mapUri) return null
  return (
    <svg aria-hidden="true" width="0" height="0" style={{ position: 'absolute' }}>
      <filter id={id} x="0%" y="0%" width="100%" height="100%" colorInterpolationFilters="sRGB">
        <feImage
          href={mapUri}
          x="0"
          y="0"
          width="100%"
          height="100%"
          preserveAspectRatio="none"
          result="map"
        />
        <feDisplacementMap
          in="SourceGraphic"
          in2="map"
          scale={options.strength * 2}
          xChannelSelector="R"
          yChannelSelector="G"
        />
      </filter>
    </svg>
  )
}

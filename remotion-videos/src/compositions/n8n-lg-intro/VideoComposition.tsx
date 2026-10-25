import React from 'react'
import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion'
import { DURATIONS, FPS, SCENE_STARTS } from './constants'
import { SceneHook } from './scenes/SceneHook'
import { ScenePain } from './scenes/ScenePain'
import { SceneSolution } from './scenes/SceneSolution'
import { SceneBuild } from './scenes/SceneBuild'
import { SceneHud } from './scenes/SceneHud'
import { SceneEdit } from './scenes/SceneEdit'
import { SceneSafety } from './scenes/SceneSafety'
import { SceneStats } from './scenes/SceneStats'
import { SceneEnd } from './scenes/SceneEnd'

const { starts } = SCENE_STARTS

/**
 * 场景之间做 12 帧交叉淡化。
 *
 * 不用 @remotion/transitions 是为了少一个依赖；场景本身都是深色底，
 * 直接叠 opacity 已经足够顺滑。
 */
const CROSSFADE = 12

const SceneWrap: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const frame = useCurrentFrame()
  const fadeIn = Math.min(1, frame / CROSSFADE)
  const fadeOutStart = dur - CROSSFADE
  const fadeOut = frame < fadeOutStart ? 1 : Math.max(0, 1 - (frame - fadeOutStart) / CROSSFADE)
  return <AbsoluteFill style={{ opacity: Math.min(fadeIn, fadeOut) }}>{children}</AbsoluteFill>
}

export const N8nLgIntro: React.FC = () => {
  const seq = (key: keyof typeof DURATIONS, Comp: React.FC) => (
    <Sequence key={key} from={starts[key]} durationInFrames={DURATIONS[key] * FPS}>
      <SceneWrap dur={DURATIONS[key] * FPS}>
        <Comp />
      </SceneWrap>
    </Sequence>
  )

  return (
    <AbsoluteFill style={{ backgroundColor: '#12141c' }}>
      {seq('hook', SceneHook)}
      {seq('pain', ScenePain)}
      {seq('solution', SceneSolution)}
      {seq('build', SceneBuild)}
      {seq('hud', SceneHud)}
      {seq('edit', SceneEdit)}
      {seq('safety', SceneSafety)}
      {seq('stats', SceneStats)}
      {seq('end', SceneEnd)}
    </AbsoluteFill>
  )
}

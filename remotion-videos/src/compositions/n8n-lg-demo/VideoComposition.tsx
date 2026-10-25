import React from 'react'
import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion'
import { DURATIONS, FPS, SCENE_STARTS } from './constants'
import { SceneEmpty } from './scenes/SceneEmpty'
import { SceneManual } from './scenes/SceneManual'
import { ScenePrompt } from './scenes/ScenePrompt'
import { SceneGenerate } from './scenes/SceneGenerate'
import { SceneRun } from './scenes/SceneRun'
import { SceneEdit } from './scenes/SceneEdit'
import { SceneHud } from './scenes/SceneHud'
import { SceneEnd } from './scenes/SceneEnd'

const { starts } = SCENE_STARTS

const CROSSFADE = 10

const SceneWrap: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const frame = useCurrentFrame()
  const fadeIn = Math.min(1, frame / CROSSFADE)
  const fadeOutStart = dur - CROSSFADE
  const fadeOut = frame < fadeOutStart ? 1 : Math.max(0, 1 - (frame - fadeOutStart) / CROSSFADE)
  return <AbsoluteFill style={{ opacity: Math.min(fadeIn, fadeOut) }}>{children}</AbsoluteFill>
}

export const N8nLgDemo: React.FC = () => {
  const seq = (key: keyof typeof DURATIONS, Comp: React.FC) => (
    <Sequence key={key} from={starts[key]} durationInFrames={DURATIONS[key] * FPS}>
      <SceneWrap dur={DURATIONS[key] * FPS}>
        <Comp />
      </SceneWrap>
    </Sequence>
  )

  return (
    <AbsoluteFill style={{ backgroundColor: '#12141c' }}>
      {seq('empty', SceneEmpty)}
      {seq('manual', SceneManual)}
      {seq('prompt', ScenePrompt)}
      {seq('generate', SceneGenerate)}
      {seq('run', SceneRun)}
      {seq('edit', SceneEdit)}
      {seq('hud', SceneHud)}
      {seq('end', SceneEnd)}
    </AbsoluteFill>
  )
}

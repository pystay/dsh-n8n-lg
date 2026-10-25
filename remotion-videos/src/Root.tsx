import React from 'react'
import { Composition } from 'remotion'
import { N8nLgIntro } from './compositions/n8n-lg-intro/VideoComposition'
import { FPS, SCENE_STARTS } from './compositions/n8n-lg-intro/constants'

export const RemotionRoot: React.FC = () => (
  <Composition
    id="n8n-lg-intro"
    component={N8nLgIntro}
    durationInFrames={SCENE_STARTS.totalFrames}
    fps={FPS}
    width={1920}
    height={1080}
  />
)

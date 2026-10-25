import React from 'react'
import { Composition } from 'remotion'
import { N8nLgIntro } from './compositions/n8n-lg-intro/VideoComposition'
import { N8nLgDemo } from './compositions/n8n-lg-demo/VideoComposition'
import { FPS as FPS_INTRO, SCENE_STARTS as STARTS_INTRO } from './compositions/n8n-lg-intro/constants'
import { FPS as FPS_DEMO, SCENE_STARTS as STARTS_DEMO } from './compositions/n8n-lg-demo/constants'

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="n8n-lg-intro"
      component={N8nLgIntro}
      durationInFrames={STARTS_INTRO.totalFrames}
      fps={FPS_INTRO}
      width={1920}
      height={1080}
    />
    <Composition
      id="n8n-lg-demo"
      component={N8nLgDemo}
      durationInFrames={STARTS_DEMO.totalFrames}
      fps={FPS_DEMO}
      width={1920}
      height={1080}
    />
  </>
)

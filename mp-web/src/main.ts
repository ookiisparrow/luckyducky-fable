import { createApp } from 'vue'
import App from './App.vue'
import { injectMpStyles } from './wxss'
import { press } from './press'
import './preview.css'

injectMpStyles()
createApp(App).directive('press', press).mount('#app')

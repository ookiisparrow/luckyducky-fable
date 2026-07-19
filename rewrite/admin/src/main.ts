import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import './styles/console.css'
import { client } from './api'
import { installErrorReporter } from './lib/errorReporter'

const app = createApp(App).use(router)
installErrorReporter(app, client) // 批 B7：前端错误上报三件套装线（治病根#14 client-error 通道 web 半边）
app.mount('#app')

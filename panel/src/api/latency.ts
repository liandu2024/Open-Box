const getLatencyFromUrlAPI = (url: string) => {
  return new Promise<number>((resolve) => {
    const startTime = performance.now()
    const img = document.createElement('img')
    img.src = url + '?_=' + new Date().getTime()
    img.style.display = 'none'
    img.onload = () => {
      const endTime = performance.now()
      img.remove()

      resolve(endTime - startTime)
    }
    img.onerror = () => {
      img.remove()

      resolve(0)
    }

    document.body.appendChild(img)
  })
}

export const getCloudflareLatencyAPI = () => {
  return getLatencyFromUrlAPI('https://www.cloudflare.com/favicon.ico')
}

export const getYouTubeLatencyAPI = () => {
  return getLatencyFromUrlAPI('https://yt3.ggpht.com/favicon.ico')
}

export const getGithubLatencyAPI = () => {
  return getLatencyFromUrlAPI('https://github.githubassets.com/favicon.ico')
}

export const getBaiduLatencyAPI = () => {
  return getLatencyFromUrlAPI('https://apps.bdimg.com/favicon.ico')
}

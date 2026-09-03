// 只声明用到的那一个函数。不装 @types/qrcode:它会把 @types/node 拉进前端的类型范围,
// setTimeout 之类的返回类型全变成 Node 的 Timeout,别处的代码跟着报错。
declare module 'qrcode' {
  interface QRCodeToDataURLOptions {
    margin?: number
    width?: number
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H'
  }
  const QRCode: {
    toDataURL(text: string, options?: QRCodeToDataURLOptions): Promise<string>
  }
  export default QRCode
}

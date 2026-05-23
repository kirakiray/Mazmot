export default async function previewWeb({ data = {}, content }) {
  const { url, title = '网页预览', width = '100%', height = '600px' } = data;
  
  if (!url) {
    return {
      success: false,
      error: 'URL 参数是必需的',
      timestamp: new Date().toISOString()
    };
  }
  
  try {
    const config = {
      url,
      title,
      width,
      height
    };
    
    return {
      success: true,
      config,
      timestamp: new Date().toISOString()
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || '预览失败',
      timestamp: new Date().toISOString()
    };
  }
}

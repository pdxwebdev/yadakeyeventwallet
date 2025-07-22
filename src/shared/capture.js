import jsQR from "jsqr";

export const capture = (webcamRef) => {
  return new Promise((resolve, reject) => {
    if (!webcamRef || !webcamRef.current) {
      throw new Error("Webcam reference is not available");
    }
    const imageSrc = webcamRef.current?.getScreenshot();
    if (!imageSrc) {
      reject(new Error("Failed to capture image from webcam"));
      return;
    }

    const img = new Image();
    img.src = imageSrc;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, img.width, img.height);
      const imageData = ctx.getImageData(0, 0, img.width, img.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height);

      if (code) {
        resolve(code.data);
      } else {
        reject(new Error("No QR code found"));
      }
    };
    img.onerror = () => reject(new Error("Failed to load captured image"));
  });
};
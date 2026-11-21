import jsQR from "jsqr";

const SCREENSHOT_TIMEOUT_MS = 3000;

export const capture = (webcamRef) => {
  return new Promise((resolve, reject) => {
    if (!webcamRef || !webcamRef.current) {
      reject(new Error("Webcam reference is not available"));
      return;
    }
    const imageSrc = webcamRef.current?.getScreenshot();
    if (!imageSrc) {
      reject(new Error("Failed to capture image from webcam"));
      return;
    }

    const img = new Image();
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(
      () => finish(reject, new Error("Timed out loading captured image")),
      SCREENSHOT_TIMEOUT_MS
    );

    // Attach handlers before assigning src: data URLs can load synchronously
    // in some browsers, and a missed onload would leave the scan hanging.
    img.onload = () => {
      try {
        if (!img.width || !img.height) {
          finish(reject, new Error("Camera frame is not ready"));
          return;
        }
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(img, 0, 0, img.width, img.height);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "attemptBoth",
        });

        if (code) {
          finish(resolve, code.data);
        } else {
          finish(reject, new Error("No QR code found"));
        }
      } catch (error) {
        finish(reject, error);
      }
    };
    img.onerror = () => finish(reject, new Error("Failed to load captured image"));
    img.src = imageSrc;
  });
};

import jsQR from "jsqr";

const SCREENSHOT_TIMEOUT_MS = 3000;
// Keep captures around 720p on phones so the PNG encode and jsQR stay fast.
const MAX_CAPTURE_EDGE = 1280;
// A camera that is still warming up produces a uniform black/grey frame.
// Decoding those wastes time and makes the modal feel frozen.
const MIN_FRAME_CONTRAST = 24;
export const SCAN_STATUS_EVENT = "yada-scan-status";

const emitStatus = (detail) => {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SCAN_STATUS_EVENT, { detail }));
  }
};

const hasVisibleContent = (imageData) => {
  const { data, width, height } = imageData;
  const stepX = Math.max(1, Math.floor(width / 48));
  const stepY = Math.max(1, Math.floor(height / 48));
  let min = 255;
  let max = 0;
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const i = (y * width + x) * 4;
      const luminance =
        (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
      if (luminance < min) min = luminance;
      if (luminance > max) max = luminance;
    }
  }
  return max - min >= MIN_FRAME_CONTRAST;
};

const captureSize = (webcamRef) => {
  const video = webcamRef?.current?.video;
  if (!video?.videoWidth || !video?.videoHeight) return null;
  const longest = Math.max(video.videoWidth, video.videoHeight);
  if (longest <= MAX_CAPTURE_EDGE) return null;
  const scale = MAX_CAPTURE_EDGE / longest;
  return {
    width: Math.round(video.videoWidth * scale),
    height: Math.round(video.videoHeight * scale),
  };
};

export const capture = (webcamRef) => {
  return new Promise((resolve, reject) => {
    if (!webcamRef || !webcamRef.current) {
      emitStatus({ phase: "error", message: "Waiting for camera…" });
      reject(new Error("Webcam reference is not available"));
      return;
    }
    const video = webcamRef.current.video;
    if (video && (video.readyState < 2 || video.paused)) {
      emitStatus({ phase: "error", message: "Camera is starting…" });
      reject(new Error("Camera frame is not ready"));
      return;
    }

    const size = captureSize(webcamRef);
    const imageSrc = size
      ? webcamRef.current.getScreenshot(size)
      : webcamRef.current.getScreenshot();
    if (!imageSrc) {
      emitStatus({ phase: "error", message: "Waiting for camera…" });
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
        emitStatus({ phase: "frame", width: img.width, height: img.height });

        if (!hasVisibleContent(imageData)) {
          emitStatus({
            phase: "miss",
            blank: true,
            width: img.width,
            height: img.height,
          });
          finish(reject, new Error("Camera frame has no visible content"));
          return;
        }

        const code = jsQR(imageData.data, imageData.width, imageData.height, {
          inversionAttempts: "attemptBoth",
        });
        if (code) {
          emitStatus({ phase: "hit", width: img.width, height: img.height });
          finish(resolve, code.data);
        } else {
          emitStatus({ phase: "miss", width: img.width, height: img.height });
          finish(reject, new Error("No QR code found"));
        }
      } catch (error) {
        emitStatus({ phase: "error", message: error.message });
        finish(reject, error);
      }
    };
    img.onerror = () => {
      emitStatus({ phase: "error", message: "Failed to load captured image" });
      finish(reject, new Error("Failed to load captured image"));
    };
    img.src = imageSrc;
  });
};

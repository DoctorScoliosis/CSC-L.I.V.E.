/*
 * Camera capture feature for the CSC Cup registration form.
 *
 * Opens a full-screen camera overlay (getUserMedia) with a portrait 3:4
 * frame, captures a centre-cropped JPEG into a per-document blob, and shows
 * a preview with a retake option. Used for the parent consent, medical
 * certificate, and import form photos.
 *
 * This module owns all of the camera DOM elements (they live in
 * CSC-CUP-Form.html). Call initCameraCapture({ onCapture }) once from the
 * page module to wire the buttons; then use the exported functions to start,
 * capture, reset, and read captures.
 *
 * The admin dashboard uses a DIFFERENT, simpler mechanism (a file input with
 * capture="environment") and does not use this module.
 */

const cameraOverlay = document.getElementById("cameraOverlay");
const cameraOverlayVideo = document.getElementById("cameraOverlayVideo");
const cameraOverlayLabel = document.getElementById("cameraOverlayLabel");
const cancelCameraOverlay = document.getElementById("cancelCameraOverlay");
const captureCameraOverlay = document.getElementById("captureCameraOverlay");

const cameras = {
	parentPage1: {
		label: "Parent Consent - Page 1",
		canvas: document.getElementById("parentPage1Canvas"),
		preview: document.getElementById("parentPage1Preview"),
		placeholder: document.getElementById("parentPage1Placeholder"),
		blob: null,
		stream: null
	},
	parentPage2: {
		label: "Parent Consent - Page 2",
		canvas: document.getElementById("parentPage2Canvas"),
		preview: document.getElementById("parentPage2Preview"),
		placeholder: document.getElementById("parentPage2Placeholder"),
		blob: null,
		stream: null
	},
	medical: {
		label: "Medical Certificate",
		canvas: document.getElementById("medicalCanvas"),
		preview: document.getElementById("medicalPreview"),
		placeholder: document.getElementById("medicalPlaceholder"),
		blob: null,
		stream: null
	},
	importFormPage1: {
		label: "Import Form with Signatures - Page 1",
		canvas: document.getElementById("importFormPage1Canvas"),
		preview: document.getElementById("importFormPage1Preview"),
		placeholder: document.getElementById("importFormPage1Placeholder"),
		blob: null,
		stream: null
	},
	importFormPage2: {
		label: "Import Form with Signatures - Page 2",
		canvas: document.getElementById("importFormPage2Canvas"),
		preview: document.getElementById("importFormPage2Preview"),
		placeholder: document.getElementById("importFormPage2Placeholder"),
		blob: null,
		stream: null
	}
};

let activeCameraType = null;
let activeCameraStream = null;
let onCaptureCallback = null;

// Wire the overlay buttons and the data-camera-start / data-camera-retake
// triggers. onCapture (optional) runs after every successful capture and
// reset — the form passes its updateSubmitAvailability so the Register
// button re-evaluates as photos come in.
export function initCameraCapture({ onCapture } = {}) {
	onCaptureCallback = onCapture || null;
	document.querySelectorAll("[data-camera-start]").forEach(button => {
		button.addEventListener("click", () => startCamera(button.dataset.cameraStart));
	});
	document.querySelectorAll("[data-camera-retake]").forEach(button => {
		button.addEventListener("click", () => startCamera(button.dataset.cameraRetake));
	});
	cancelCameraOverlay?.addEventListener("click", () => stopCamera());
	captureCameraOverlay?.addEventListener("click", () => capturePhoto());
	window.addEventListener("beforeunload", () => {
		Object.keys(cameras).forEach(stopCamera);
	});
}

export function stopCamera(type) {
	if (type && cameras[type]) {
		cameras[type].stream?.getTracks().forEach(track => track.stop());
		cameras[type].stream = null;
	}
	if (activeCameraStream) {
		activeCameraStream.getTracks().forEach(track => track.stop());
		activeCameraStream = null;
	}
	cameraOverlayVideo.srcObject = null;
	cameraOverlay.classList.remove("is-open");
	document.body.classList.remove("overflow-hidden");
	activeCameraType = null;
}

export async function startCamera(type) {
	const camera = cameras[type];
	stopCamera(type);
	if (!navigator.mediaDevices?.getUserMedia) {
		window.alert("Camera access is not supported by this browser. Please use a camera-capable mobile browser.");
		return;
	}
	try {
		activeCameraType = type;
		cameraOverlayLabel.textContent = camera.label || "Document Camera";
		activeCameraStream = await navigator.mediaDevices.getUserMedia({
			video: {
				facingMode: { ideal: "environment" },
				width: { ideal: 1080 },
				height: { ideal: 1920 },
				aspectRatio: { ideal: 0.75 }
			},
			audio: false
		});
		camera.stream = activeCameraStream;
		cameraOverlayVideo.srcObject = activeCameraStream;
		camera.preview.classList.add("hidden");
		camera.placeholder.classList.add("hidden");
		document.querySelector(`[data-camera-retake="${type}"]`)?.classList.add("hidden");
		cameraOverlay.classList.add("is-open");
		document.body.classList.add("overflow-hidden");
	} catch (error) {
		console.error("Camera error:", error);
		window.alert("Unable to open the camera. Please allow camera permission and try again.");
	}
}

export async function capturePhoto(type = activeCameraType) {
	const camera = cameras[type];
	if (!camera || !activeCameraStream) {
		window.alert("Please open the camera before taking a picture.");
		return;
	}
	const sourceWidth = cameraOverlayVideo.videoWidth || 1080;
	const sourceHeight = cameraOverlayVideo.videoHeight || 1920;
	const targetWidth = 1080;
	const targetHeight = 1440;
	const targetRatio = targetWidth / targetHeight;
	let cropWidth = sourceWidth;
	let cropHeight = cropWidth / targetRatio;
	if (cropHeight > sourceHeight) {
		cropHeight = sourceHeight;
		cropWidth = cropHeight * targetRatio;
	}
	const cropX = (sourceWidth - cropWidth) / 2;
	const cropY = (sourceHeight - cropHeight) / 2;
	camera.canvas.width = targetWidth;
	camera.canvas.height = targetHeight;
	camera.canvas.getContext("2d").drawImage(
		cameraOverlayVideo,
		cropX,
		cropY,
		cropWidth,
		cropHeight,
		0,
		0,
		targetWidth,
		targetHeight
	);
	camera.blob = await new Promise(resolve => camera.canvas.toBlob(resolve, "image/jpeg", 0.9));
	camera.preview.src = URL.createObjectURL(camera.blob);
	camera.preview.classList.remove("hidden");
	camera.placeholder.classList.add("hidden");
	document.querySelector(`[data-camera-retake="${type}"]`)?.classList.remove("hidden");
	stopCamera();
	if (onCaptureCallback) onCaptureCallback(type);
}

export function resetCameraCapture(type) {
	const camera = cameras[type];
	if (!camera) {
		return;
	}
	stopCamera(type);
	camera.blob = null;
	camera.preview.removeAttribute("src");
	camera.preview.classList.add("hidden");
	camera.placeholder.classList.remove("hidden");
	document.querySelector(`[data-camera-retake="${type}"]`)?.classList.add("hidden");
	if (onCaptureCallback) onCaptureCallback(type);
}

export function clearAllCaptures() {
	Object.keys(cameras).forEach(resetCameraCapture);
}

export function getCameraBlob(type) {
	return cameras[type]?.blob || null;
}

export function hasCameraCapture(type) {
	return Boolean(cameras[type]?.blob);
}
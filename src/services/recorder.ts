let mediaRecorder: MediaRecorder | null = null;
let audioChunks: Blob[] = [];
let startTime: number = 0;

export const startRecording = async (): Promise<void> => {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  mediaRecorder = new MediaRecorder(stream);
  audioChunks = [];
  startTime = Date.now();

  mediaRecorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      audioChunks.push(event.data);
    }
  };

  mediaRecorder.start();
};

export const stopRecording = (): Promise<{ blob: Blob; duration: number }> => {
  return new Promise((resolve, reject) => {
    if (!mediaRecorder) {
      reject(new Error('No recording in progress'));
      return;
    }

    mediaRecorder.onstop = () => {
      const duration = (Date.now() - startTime) / 1000;
      const blob = new Blob(audioChunks, { type: 'audio/webm' });
      audioChunks = [];
      
      mediaRecorder?.stream.getTracks().forEach((track) => track.stop());
      mediaRecorder = null;
      
      resolve({ blob, duration });
    };

    mediaRecorder.stop();
  });
};

export const cancelRecording = (): void => {
  if (mediaRecorder) {
    mediaRecorder.stream.getTracks().forEach((track) => track.stop());
    mediaRecorder = null;
    audioChunks = [];
  }
};

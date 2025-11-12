import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { GoogleGenAI } from '@google/genai';
import type { AspectRatio } from './types';

// Helper to convert File to Base64 string
const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = (error) => reject(error);
  });

// SVG Icons
const UploadIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
    </svg>
);

const VideoIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
);

const LoadingSpinner = () => (
  <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-cyan-500"></div>
);

const loadingMessages = [
    "Warming up the creative engines...",
    "Gathering pixels and inspiration...",
    "This can take a few minutes, great art needs patience.",
    "Composing your video masterpiece...",
    "Finalizing the special effects..."
];

// Main App Component
const App = () => {
    const [apiKeySelected, setApiKeySelected] = useState<boolean | null>(null);
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [prompt, setPrompt] = useState<string>("uma pessoa com malas atravessando a ponte da amizade do brasil para o paraguai");
    const [aspectRatio, setAspectRatio] = useState<AspectRatio>('16:9');
    const [isLoading, setIsLoading] = useState<boolean>(false);
    const [loadingMessage, setLoadingMessage] = useState<string>(loadingMessages[0]);
    const [generatedVideoUrl, setGeneratedVideoUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const checkKey = async () => {
            try {
                if (window.aistudio && typeof window.aistudio.hasSelectedApiKey === 'function') {
                    const hasKey = await window.aistudio.hasSelectedApiKey();
                    setApiKeySelected(hasKey);
                } else {
                     // Fallback for environments where aistudio is not available
                    setApiKeySelected(true); 
                }
            } catch (err) {
                console.error("Error checking API key:", err);
                setError("Could not verify API key status. Assuming key is present.");
                setApiKeySelected(true);
            }
        };
        checkKey();
    }, []);

    useEffect(() => {
        if (isLoading) {
            const intervalId = setInterval(() => {
                setLoadingMessage(prev => {
                    const currentIndex = loadingMessages.indexOf(prev);
                    const nextIndex = (currentIndex + 1) % loadingMessages.length;
                    return loadingMessages[nextIndex];
                });
            }, 3000);
            return () => clearInterval(intervalId);
        }
    }, [isLoading]);

    useEffect(() => {
        const urlToRevoke = generatedVideoUrl;
        return () => {
            if (urlToRevoke) {
                URL.revokeObjectURL(urlToRevoke);
            }
        };
    }, [generatedVideoUrl]);

    const handleSelectKey = async () => {
        if (window.aistudio && typeof window.aistudio.openSelectKey === 'function') {
            await window.aistudio.openSelectKey();
            // Optimistically assume key selection was successful to unblock the UI.
            setApiKeySelected(true);
        }
    };
    
    const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (generatedVideoUrl) {
                setGeneratedVideoUrl(null); // Will trigger useEffect cleanup
            }
            setImageFile(file);
            const previewUrl = URL.createObjectURL(file);
            setImagePreview(previewUrl);
        }
    };

    const handleGenerateVideo = useCallback(async () => {
        if (!imageFile || !prompt) {
            setError("Please upload an image and provide a prompt.");
            return;
        }

        setIsLoading(true);
        setError(null);
        if (generatedVideoUrl) {
            setGeneratedVideoUrl(null); // Will trigger useEffect cleanup
        }

        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const imageBase64 = await fileToBase64(imageFile);

            let operation = await ai.models.generateVideos({
                model: 'veo-3.1-fast-generate-preview',
                prompt,
                image: {
                    imageBytes: imageBase64,
                    mimeType: imageFile.type,
                },
                config: {
                    numberOfVideos: 1,
                    resolution: '720p',
                    aspectRatio,
                }
            });

            while (!operation.done) {
                await new Promise(resolve => setTimeout(resolve, 10000));
                operation = await ai.operations.getVideosOperation({ operation: operation });
            }

            const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
            if (videoUri && process.env.API_KEY) {
                const videoResponse = await fetch(`${videoUri}&key=${process.env.API_KEY}`);
                if (!videoResponse.ok) {
                    throw new Error(`Failed to fetch video: ${videoResponse.statusText}`);
                }
                const videoBlob = await videoResponse.blob();
                const objectUrl = URL.createObjectURL(videoBlob);
                setGeneratedVideoUrl(objectUrl);
            } else {
                 throw new Error("Video generation completed, but no video URI was found.");
            }

        } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : "An unknown error occurred.";
            console.error(err);
             if (errorMessage.includes('Requested entity was not found')) {
                setError('Your API key is invalid or not configured. Please select a valid key.');
                setApiKeySelected(false);
            } else {
                setError(`Failed to generate video: ${errorMessage}`);
            }
        } finally {
            setIsLoading(false);
        }
    }, [imageFile, prompt, aspectRatio]);

    const isGenerateDisabled = useMemo(() => isLoading || !imageFile || !prompt, [isLoading, imageFile, prompt]);

    const renderContent = () => {
        if (apiKeySelected === null) {
            return <div className="flex justify-center items-center h-full"><LoadingSpinner /></div>;
        }

        if (!apiKeySelected) {
            return (
                <div className="text-center p-8 bg-gray-800 rounded-lg shadow-xl">
                    <h2 className="text-2xl font-bold mb-4">API Key Required</h2>
                    <p className="mb-6 text-gray-400">To use Veo video generation, you need to select an API key associated with a project that has billing enabled.</p>
                    <button 
                        onClick={handleSelectKey}
                        className="bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-2 px-4 rounded-lg transition-colors"
                    >
                        Select API Key
                    </button>
                    <p className="text-xs text-gray-500 mt-4">
                        For more information, see the <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline">billing documentation</a>.
                    </p>
                </div>
            );
        }
        
        if (isLoading) {
            return (
                <div className="text-center p-8 flex flex-col items-center justify-center">
                    <LoadingSpinner />
                    <p className="mt-6 text-xl text-gray-300">{loadingMessage}</p>
                </div>
            );
        }

        if (generatedVideoUrl) {
            return (
                <div className="w-full max-w-2xl mx-auto">
                    <h2 className="text-3xl font-bold text-center mb-6">Your Animated Image!</h2>
                    <video 
                        src={generatedVideoUrl} 
                        controls 
                        autoPlay 
                        loop
                        className={`w-full rounded-lg shadow-2xl ${aspectRatio === '16:9' ? 'aspect-video' : 'aspect-[9/16]'}`}
                    />
                    <button
                        onClick={() => {
                            setGeneratedVideoUrl(null);
                            setImageFile(null);
                            setImagePreview(null);
                        }}
                        className="mt-8 w-full bg-cyan-600 hover:bg-cyan-700 text-white font-bold py-3 px-4 rounded-lg transition-colors flex items-center justify-center text-lg"
                    >
                        Create Another
                    </button>
                </div>
            );
        }

        return (
            <div className="w-full max-w-md space-y-6">
                <div className="text-center">
                    <h1 className="text-4xl font-bold tracking-tight">Animate with Veo</h1>
                    <p className="mt-2 text-lg text-gray-400">Bring your images to life.</p>
                </div>
                
                {error && <div className="bg-red-900/50 border border-red-700 text-red-300 px-4 py-3 rounded-lg" role="alert">{error}</div>}

                <div className="space-y-4">
                    <label htmlFor="image-upload" className="block text-sm font-medium text-gray-300">1. Upload Image</label>
                    <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-600 border-dashed rounded-md hover:border-cyan-500 transition-colors">
                        <div className="space-y-1 text-center">
                            {imagePreview ? (
                                <img src={imagePreview} alt="Preview" className="mx-auto h-40 w-auto rounded-md" />
                            ) : (
                                <>
                                    <UploadIcon />
                                    <div className="flex text-sm text-gray-400">
                                        <label htmlFor="image-upload" className="relative cursor-pointer bg-gray-800 rounded-md font-medium text-cyan-400 hover:text-cyan-300 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-offset-gray-900 focus-within:ring-cyan-500 px-1">
                                            <span>Upload a file</span>
                                            <input id="image-upload" name="image-upload" type="file" className="sr-only" accept="image/*" onChange={handleImageChange} />
                                        </label>
                                    </div>
                                    <p className="text-xs text-gray-500">PNG, JPG, GIF up to 10MB</p>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                <div>
                    <label htmlFor="prompt" className="block text-sm font-medium text-gray-300">2. Describe the Animation</label>
                    <textarea
                        id="prompt"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        rows={3}
                        className="mt-1 block w-full bg-gray-800 border-gray-600 rounded-md shadow-sm focus:ring-cyan-500 focus:border-cyan-500 sm:text-sm text-white placeholder-gray-500 p-3"
                        placeholder="e.g., A gentle breeze makes the leaves rustle."
                    />
                </div>

                <div>
                    <h3 className="text-sm font-medium text-gray-300">3. Select Aspect Ratio</h3>
                    <fieldset className="mt-2">
                        <div className="flex space-x-4">
                            {(['16:9', '9:16'] as AspectRatio[]).map((ratio) => (
                                <label key={ratio} className={`flex-1 relative bg-gray-800 border rounded-md p-4 flex items-center justify-center text-sm font-medium cursor-pointer focus:outline-none ${aspectRatio === ratio ? 'bg-cyan-900/50 border-cyan-500 text-white' : 'border-gray-600 text-gray-400 hover:bg-gray-700'}`}>
                                    <input type="radio" name="aspect-ratio" value={ratio} className="sr-only" aria-labelledby={`aspect-ratio-${ratio}-label`} checked={aspectRatio === ratio} onChange={() => setAspectRatio(ratio)} />
                                    <span id={`aspect-ratio-${ratio}-label`}>{ratio === '16:9' ? 'Landscape (16:9)' : 'Portrait (9:16)'}</span>
                                </label>
                            ))}
                        </div>
                    </fieldset>
                </div>
                
                <button
                    onClick={handleGenerateVideo}
                    disabled={isGenerateDisabled}
                    className="w-full flex justify-center items-center py-3 px-4 border border-transparent rounded-md shadow-sm text-lg font-medium text-white bg-cyan-600 hover:bg-cyan-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-gray-900 focus:ring-cyan-500 disabled:bg-gray-600 disabled:cursor-not-allowed transition-colors"
                >
                    <VideoIcon/>
                    Generate Video
                </button>
            </div>
        );
    };

    return (
        <main className="min-h-screen flex flex-col items-center justify-center p-4 sm:p-6 lg:p-8">
            {renderContent()}
        </main>
    );
};

export default App;
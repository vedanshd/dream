import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { dreamInputSchema, DreamInput } from "@shared/schema";
import { ZodError } from "zod";
import { fromZodError } from "zod-validation-error";
import { OpenAIClient } from "./openai";
import { mockAnalyzeDream } from "./mock-dream-analyzer";

export async function registerRoutes(app: Express): Promise<Server> {
  // Initialize OpenAI client
  const openAI = new OpenAIClient(process.env.OPENAI_API_KEY || "");

  // API routes
  app.post("/api/dreams/analyze", async (req, res) => {
    try {
      const dreamInput = dreamInputSchema.parse(req.body);
      
      // Call OpenAI API to analyze the dream
      const dreamAnalysis = await analyzeDream(openAI, dreamInput);
      
      // Save dream with analysis
      const savedDream = await storage.createDream({
        title: dreamInput.title || null,
        dreamCues: dreamInput.dreamCues,
        isRecurring: dreamInput.isRecurring,
        primaryEmotion: dreamInput.primaryEmotion,
        wakeFeeling: dreamInput.wakeFeeling,
        additionalEmotions: dreamInput.additionalEmotions || null,
        dreamNarrative: dreamAnalysis.dreamNarrative,
        psychologicalReport: dreamAnalysis.psychologicalReport
      });
      
      return res.status(200).json({ 
        id: savedDream.id,
        ...dreamAnalysis 
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return res.status(400).json({
          message: fromZodError(error).message
        });
      }
      
      console.error("Error analyzing dream:", error);
      return res.status(500).json({
        message: "Failed to analyze dream",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/dreams", async (req, res) => {
    try {
      const dreams = await storage.getAllDreams();
      return res.status(200).json(dreams);
    } catch (error) {
      console.error("Error fetching dreams:", error);
      return res.status(500).json({
        message: "Failed to fetch dreams",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  app.get("/api/dreams/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ message: "Invalid dream ID" });
      }
      
      const dream = await storage.getDream(id);
      if (!dream) {
        return res.status(404).json({ message: "Dream not found" });
      }
      
      return res.status(200).json(dream);
    } catch (error) {
      console.error("Error fetching dream:", error);
      return res.status(500).json({
        message: "Failed to fetch dream",
        error: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

async function analyzeDream(openAI: OpenAIClient, dreamInput: DreamInput) {
  try {
    // Try using the OpenAI API first
    const response = await openAI.createChatCompletion({
      messages: [
        {
          role: "system",
          content: `You are an expert in dream interpretation and psychology. 
          Analyze the user's dream fragments and emotional context to generate:
          1. A complete, vivid dream narrative (350-500 words) that incorporates all the dream cues provided
          2. A psychological interpretation including key symbols, analysis summary, and reflection questions
          Format your response as JSON with the following structure:
          {
            "title": "Creative title for the dream",
            "dreamNarrative": "Full dream narrative...",
            "psychologicalReport": {
              "keySymbols": [
                {
                  "symbol": "Name of dream element",
                  "icon": "A relevant Remix icon name (e.g., 'plant-line', 'home-4-line')",
                  "meaning": "Psychological interpretation of this symbol"
                }
              ],
              "analysisSummary": "Psychological analysis of the dream...",
              "reflectionQuestions": [
                "Question 1 for the dreamer to reflect on",
                "Question 2 for the dreamer to reflect on",
                "Question 3 for the dreamer to reflect on",
                "Question 4 for the dreamer to reflect on"
              ]
            }
          }`
        },
        {
          role: "user",
          content: `Dream Fragments: ${dreamInput.dreamCues}
          Recurring Dream: ${dreamInput.isRecurring ? "Yes" : "No"}
          Primary Emotion: ${dreamInput.primaryEmotion}
          Waking Feeling: ${dreamInput.wakeFeeling}/5 (1=Unsettled, 5=Refreshed)
          Additional Emotional Context: ${dreamInput.additionalEmotions ?? "None provided"}`
        }
      ],
      response_format: { type: "json_object" }
    });

    if (!response.choices?.[0]?.message?.content) {
      throw new Error("Invalid response from OpenAI API");
    }

    const analysisContent = response.choices[0].message.content;
    return JSON.parse(analysisContent);
  } catch (error) {
    console.log("OpenAI API failed, using mock dream analyzer instead:", error instanceof Error ? error.message : "Unknown error");
    
    // Fall back to our mock dream analyzer
    return mockAnalyzeDream(dreamInput);
  }
}

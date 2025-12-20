import axios from 'axios';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    transports: [new winston.transports.Console()],
});

const POLLINATIONS_URL = 'https://text.pollinations.ai/openai';

export interface PlaylistRequest {
    description: string;           // Mood/genre description
    count: number;                 // Number of songs
    mode: 'unique' | 'repeat' | 'shuffle';  // Playlist mode
}

export interface PlaylistSong {
    searchQuery: string;
    title: string;
    artist?: string;
}

export interface GeneratedPlaylist {
    name: string;
    songs: PlaylistSong[];
    description: string;
}

export class AIPlaylistService {

    /**
     * Generate a playlist using AI based on a mood or description
     */
    public async generatePlaylist(request: PlaylistRequest): Promise<GeneratedPlaylist> {
        const { description, count, mode } = request;

        logger.info(`Generating AI playlist: "${description}" with ${count} songs (${mode} mode)`);

        const prompt = `You are a music recommendation AI. Generate a playlist of exactly ${count} songs based on this description: "${description}"

Rules:
1. Return ONLY a valid JSON object, no markdown, no explanation
2. Include popular and well-known songs that match the mood
3. Mix different artists unless specifically asked for one artist
4. For Arabic/regional music requests, include authentic artists from that region
5. The searchQuery should be: "Artist - Song Title" format for best YouTube search results

Return this exact JSON format:
{
  "name": "Playlist Name",
  "description": "Brief description of the playlist mood",
  "songs": [
    {"searchQuery": "Artist Name - Song Title", "title": "Song Title", "artist": "Artist Name"},
    ...
  ]
}`;

        try {
            const response = await axios.post(POLLINATIONS_URL, {
                model: 'openai',
                messages: [
                    { role: 'system', content: 'You are a music playlist generator. You only respond with valid JSON.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.8,
                max_tokens: 2000
            }, {
                timeout: 30000,
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            // Parse the AI response
            let content = response.data.choices?.[0]?.message?.content || response.data;

            // If it's a string, try to parse JSON from it
            if (typeof content === 'string') {
                // Remove markdown code blocks if present
                content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
                content = JSON.parse(content);
            }

            const playlist: GeneratedPlaylist = {
                name: content.name || `${description} Playlist`,
                description: content.description || description,
                songs: content.songs || []
            };

            // Apply mode transformations
            if (mode === 'shuffle') {
                playlist.songs = this.shuffleArray([...playlist.songs]);
            }

            logger.info(`Generated playlist "${playlist.name}" with ${playlist.songs.length} songs`);
            return playlist;

        } catch (error: any) {
            logger.error('AI playlist generation failed:', error.message);
            throw new Error(`Failed to generate playlist: ${error.message}`);
        }
    }

    /**
     * Quick generate based on simple keywords
     */
    public async quickGenerate(keywords: string, count: number = 5): Promise<PlaylistSong[]> {
        const playlist = await this.generatePlaylist({
            description: keywords,
            count,
            mode: 'unique'
        });
        return playlist.songs;
    }

    /**
     * Shuffle array using Fisher-Yates algorithm
     */
    private shuffleArray<T>(array: T[]): T[] {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }
}

export const aiPlaylistService = new AIPlaylistService();

import axios, { AxiosInstance } from 'axios';
import { config } from '../config';
import winston from 'winston';

const logger = winston.createLogger({
    level: 'info',
    transports: [new winston.transports.Console()],
});

export class RestreamerService {
    private client: AxiosInstance;
    private token: string | null = null;

    constructor() {
        this.client = axios.create({
            baseURL: config.core.url,
        });
    }

    private async login() {
        try {
            const res = await this.client.post('/api/login', {
                username: config.core.username,
                password: config.core.password,
            });
            this.token = res.data.access_token;
            logger.info('Logged into Restreamer');
        } catch (error) {
            logger.error('Restreamer login failed', error);
            throw error;
        }
    }

    private async request(method: 'get' | 'put' | 'post', url: string, data?: any) {
        if (!this.token) await this.login();
        try {
            return await this.client.request({
                method,
                url,
                data,
                headers: { Authorization: `Bearer ${this.token}` }
            });
        } catch (error: any) {
            if (error.response?.status === 401) {
                logger.warn('Token expired, retrying login...');
                await this.login();
                return await this.client.request({
                    method,
                    url,
                    data,
                    headers: { Authorization: `Bearer ${this.token}` }
                });
            }
            throw error;
        }
    }

    public async cancelProcess() {
        try {
            await this.request('put', `/api/v3/process/${config.core.processId}/command`, { command: 'stop' });
        } catch (e) {
            // Ignore if not running
        }
    }

    public async startProcess() {
        await this.request('put', `/api/v3/process/${config.core.processId}/command`, { command: 'start' });
    }

    public async updateProcessConfig(filePath: string, loop: boolean = false) {
        // Get current config to preserve output settings
        let currentConfig: any = {};
        try {
            const res = await this.request('get', `/api/v3/process/${config.core.processId}`);
            currentConfig = res.data;
        } catch (e) {
            logger.warn('Process not found, creating new config might be needed.');
        }

        // Prepare input config for ffmpeg
        const inputOptions = ["-re"]; // Read at native frame rate
        if (loop) {
            inputOptions.unshift("-stream_loop", "-1"); // Infinite loop
        }

        const newInput = [
            {
                "id": "input_0",
                "address": `file://${filePath}`,
                "options": inputOptions
            }
        ];

        const newConfig = {
            ...currentConfig,
            config: {
                ...currentConfig.config,
                input: newInput
            }
        };

        await this.request('put', `/api/v3/process/${config.core.processId}`, newConfig);
        logger.info(`Updated process config to play: ${filePath}${loop ? ' (looping)' : ''}`);
    }
}

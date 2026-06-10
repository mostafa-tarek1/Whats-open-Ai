import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Put, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';
import { AiReplyService } from './ai-reply.service';
import type {
  AiConfigResponse,
  AiInteraction,
  AiKnowledgeResponse,
  AiStatus,
  UpdateAiConfigPayload,
} from './ai-reply.service';

@ApiTags('ai')
@Controller('ai')
export class AiController {
  constructor(private readonly aiReplyService: AiReplyService) {}

  @Get('status')
  @ApiOperation({ summary: 'Get AI auto-reply status' })
  @ApiResponse({ status: 200, description: 'AI auto-reply status' })
  getStatus(): Promise<AiStatus> {
    return this.aiReplyService.getStatus();
  }

  @Get('config')
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Get sanitized AI auto-reply configuration' })
  @ApiResponse({ status: 200, description: 'AI auto-reply configuration' })
  getConfig(): Promise<AiConfigResponse> {
    return this.aiReplyService.getConfig();
  }

  @Put('config')
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Update AI auto-reply configuration' })
  @ApiResponse({ status: 200, description: 'AI auto-reply configuration updated' })
  updateConfig(@Body() payload: UpdateAiConfigPayload): Promise<AiConfigResponse> {
    return this.aiReplyService.updateConfig(payload);
  }

  @Get('knowledge')
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Get AI knowledge base content' })
  @ApiResponse({ status: 200, description: 'AI knowledge base content' })
  getKnowledge(): Promise<AiKnowledgeResponse> {
    return this.aiReplyService.getKnowledge();
  }

  @Put('knowledge')
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Update AI knowledge base content' })
  @ApiResponse({ status: 200, description: 'AI knowledge base updated' })
  updateKnowledge(@Body('content') content = ''): Promise<AiKnowledgeResponse> {
    return this.aiReplyService.updateKnowledge(content);
  }

  @Get('interactions')
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'List recent AI questions and replies' })
  @ApiResponse({ status: 200, description: 'Recent AI interaction log' })
  getInteractions(@Query('limit') limit?: string): Promise<AiInteraction[]> {
    return this.aiReplyService.getInteractions(limit ? Number(limit) : 100);
  }

  @Delete('interactions')
  @RequireRole(ApiKeyRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Clear AI interaction log' })
  @ApiResponse({ status: 204, description: 'AI interaction log cleared' })
  clearInteractions(): Promise<void> {
    return this.aiReplyService.clearInteractions();
  }
}

import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { RequireRole } from '../auth/decorators/auth.decorators';
import { ApiKeyRole } from '../auth/entities/api-key.entity';
import { AiApiLinksService } from './ai-api-links.service';
import type {
  AiApiLink,
  AiApiTestResult,
  CreateAiApiLinkPayload,
  UpdateAiApiLinkPayload,
} from './ai-api-links.service';

@ApiTags('ai')
@Controller('ai/apis')
export class AiApiLinksController {
  constructor(private readonly apiLinksService: AiApiLinksService) {}

  @Get()
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'List configured AI API links (slash commands)' })
  @ApiResponse({ status: 200, description: 'List of API links' })
  list(): Promise<AiApiLink[]> {
    return this.apiLinksService.list();
  }

  @Post()
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Register a new AI API link callable via /slug from Reply Data' })
  @ApiResponse({ status: 201, description: 'API link created' })
  create(@Body() payload: CreateAiApiLinkPayload): Promise<AiApiLink> {
    return this.apiLinksService.create(payload);
  }

  @Put(':id')
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Update an existing AI API link' })
  @ApiResponse({ status: 200, description: 'API link updated' })
  update(@Param('id') id: string, @Body() payload: UpdateAiApiLinkPayload): Promise<AiApiLink> {
    return this.apiLinksService.update(id, payload);
  }

  @Delete(':id')
  @RequireRole(ApiKeyRole.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an AI API link' })
  @ApiResponse({ status: 204, description: 'API link deleted' })
  remove(@Param('id') id: string): Promise<void> {
    return this.apiLinksService.remove(id);
  }

  @Post(':id/test')
  @RequireRole(ApiKeyRole.ADMIN)
  @ApiOperation({ summary: 'Probe an AI API link and store its latest status' })
  @ApiResponse({ status: 200, description: 'Test result' })
  test(@Param('id') id: string): Promise<AiApiTestResult> {
    return this.apiLinksService.test(id);
  }
}

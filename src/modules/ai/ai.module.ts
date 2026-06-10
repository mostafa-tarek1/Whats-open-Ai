import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiApiLinksController } from './ai-api-links.controller';
import { AiReplyService } from './ai-reply.service';
import { AiApiLinksService } from './ai-api-links.service';
import { MessageModule } from '../message/message.module';

@Module({
  imports: [MessageModule],
  controllers: [AiController, AiApiLinksController],
  providers: [AiReplyService, AiApiLinksService],
  exports: [AiReplyService, AiApiLinksService],
})
export class AiModule {}

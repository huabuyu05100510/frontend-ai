import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export enum ExportFormatEnum {
  JSONL = 'jsonl',
}

export class ExportQueryDto {
  @ApiPropertyOptional({ enum: ExportFormatEnum, default: ExportFormatEnum.JSONL })
  @IsOptional()
  @IsEnum(ExportFormatEnum)
  format?: ExportFormatEnum;

  @ApiPropertyOptional({ description: '起始时间戳 (ms)，默认 0' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  since?: number;

  @ApiPropertyOptional({ description: '最大导出条数，默认 10000' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number;
}
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export enum AnnotationKindEnum {
  ALIGN_FIX = 'align_fix',
  SEG_RATING = 'seg_rating',
  ALT_TRANS = 'alt_trans',
}

export class ContextDto {
  @ApiProperty({ required: false, description: '前一段原文，限长 500 字符' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  prevSrc?: string;

  @ApiProperty({ required: false, description: '后一段原文，限长 500 字符' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  nextSrc?: string;
}

export class CreateAnnotationDto {
  @ApiProperty({ description: 'uuid v4 客户端生成' })
  @IsString()
  @Matches(/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/, {
    message: 'id must be uuid v4',
  })
  id!: string;

  @ApiProperty({ enum: AnnotationKindEnum })
  @IsEnum(AnnotationKindEnum)
  kind!: AnnotationKindEnum;

  @ApiProperty({ default: 1 })
  @IsInt()
  @Min(1)
  schemaVersion!: number;

  @ApiProperty()
  @IsString()
  @MaxLength(2048)
  url!: string;

  @ApiProperty({ description: 'XPath 路径' })
  @IsString()
  @MaxLength(2048)
  domPath!: string;

  @ApiProperty({ description: 'data-xt-id' })
  @IsString()
  @MaxLength(256)
  srcSegmentId!: string;

  @ApiProperty({ type: [String], example: ['zh', 'en'] })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(2)
  @IsString({ each: true })
  langPair!: [string, string];

  @ApiProperty()
  @IsString()
  @MaxLength(5000)
  srcText!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(5000)
  tgtText!: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(2000)
  srcTokens!: string[];

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(2000)
  tgtTokens!: string[];

  @ApiProperty({
    type: 'array',
    items: { type: 'array', items: { type: 'integer' } },
    example: [[0, 0], [1, 1]],
  })
  @IsArray()
  @ArrayMaxSize(5000)
  predicted!: Array<[number, number]>;

  @ApiProperty({ example: 'nllb-600m-l0h15-v1' })
  @IsString()
  @MaxLength(64)
  modelVersion!: string;

  @ApiProperty({ description: '类型特定 payload' })
  payload!: Record<string, unknown>;

  @ApiProperty({ required: false, type: ContextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ContextDto)
  context?: ContextDto;

  @ApiProperty({ description: 'Date.now()' })
  @IsNumber()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  createdAt!: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  appVersion?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  userAgent?: string;
}

export class CreateAnnotationBatchDto {
  @ApiProperty({ type: [CreateAnnotationDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(1000)
  @ValidateNested({ each: true })
  @Type(() => CreateAnnotationDto)
  items!: CreateAnnotationDto[];
}
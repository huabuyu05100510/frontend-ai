import { ApiProperty } from '@nestjs/swagger';

/** 数据库行（内部表示） */
export class AnnotationRow {
  @ApiProperty()
  id!: string;
  @ApiProperty()
  kind!: string;
  @ApiProperty()
  schema_version!: number;
  @ApiProperty()
  url!: string;
  @ApiProperty()
  dom_path!: string;
  @ApiProperty()
  src_segment_id!: string;
  @ApiProperty()
  lang_pair!: string;
  @ApiProperty()
  src_text!: string;
  @ApiProperty()
  tgt_text!: string;
  @ApiProperty()
  src_tokens_json!: string;
  @ApiProperty()
  tgt_tokens_json!: string;
  @ApiProperty()
  predicted_json!: string;
  @ApiProperty()
  model_version!: string;
  @ApiProperty()
  payload_json!: string;
  @ApiProperty({ required: false, nullable: true })
  context_json!: string | null;
  @ApiProperty()
  created_at!: number;
  @ApiProperty({ required: false, nullable: true })
  app_version!: string | null;
  @ApiProperty({ required: false, nullable: true })
  user_agent!: string | null;
  @ApiProperty()
  received_at!: number;
}
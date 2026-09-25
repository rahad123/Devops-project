import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ListCustomersQueryDto {
  @ApiPropertyOptional({ example: 'rahad' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;
}

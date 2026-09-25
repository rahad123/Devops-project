import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateOperatorDto {
  @ApiPropertyOptional({ example: 'Shyamoli Paribahan' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;
}

import { IsString, IsOptional, IsInt, Min, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRouteDto {
  @ApiProperty({ example: 'Sylhet' })
  @IsString()
  @MaxLength(100)
  source: string;

  @ApiProperty({ example: 'Dhaka' })
  @IsString()
  @MaxLength(100)
  destination: string;

  @ApiPropertyOptional({ example: 247 })
  @IsOptional()
  @IsInt()
  @Min(1)
  distanceKm?: number;
}

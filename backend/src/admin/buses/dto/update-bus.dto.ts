import { IsString, IsOptional, IsEnum, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { BusType } from '@prisma/client';

export class UpdateBusDto {
  @ApiPropertyOptional({ example: 'Shyamoli Volvo 3' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  name?: string;

  @ApiPropertyOptional({ enum: BusType })
  @IsOptional()
  @IsEnum(BusType)
  busType?: BusType;
}

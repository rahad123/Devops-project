import { IsString, IsOptional, IsDateString, IsInt, Min, IsIn } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class SearchBusesDto {
  @ApiPropertyOptional({ example: 'Mumbai' })
  @IsString()
  source: string;

  @ApiPropertyOptional({ example: 'Pune' })
  @IsString()
  destination: string;

  @ApiPropertyOptional({ example: '2026-09-10' })
  @IsDateString()
  travelDate: string;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  passengers?: number;

  @ApiPropertyOptional({ enum: ['AC_SEATER', 'AC_SLEEPER', 'NON_AC_SEATER', 'NON_AC_SLEEPER'] })
  @IsOptional()
  @IsIn(['AC_SEATER', 'AC_SLEEPER', 'NON_AC_SEATER', 'NON_AC_SLEEPER'])
  busType?: string;

  @ApiPropertyOptional({ example: '06:00' })
  @IsOptional()
  @IsString()
  departureTime?: string;

  @ApiPropertyOptional({ example: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  minAvailableSeats?: number;
}
